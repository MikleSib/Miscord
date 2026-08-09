import '/audio/deepfilternet3/dfn3-glue.js';

const FRAME_SIZE = 480;
/**
 * Запас в два кадра: очередь обработанного звука пополняется пачками по 480,
 * а расходуется по одному сэмплу, поэтому меньший запас периодически пустеет.
 * Обе очереди заполняются тишиной заранее — иначе первые кадры пришлось бы
 * отдавать без задержки, а потом повторять их же уже задержанными.
 */
const PRIME_SAMPLES = FRAME_SIZE * 2;
const FIFO_CAPACITY = 16384;
const CROSSFADE_SAMPLES = 960;
/**
 * Нормализация признаков внутри модели — это скользящее среднее с постоянной
 * времени в секунду, стартующее с уровня −60..−90 dB. Пока оно не сошлось,
 * модель переоценивает шум и душит речь, поэтому первые полсекунды обработку
 * вводим плавно, а не обрываем голос на входе в канал.
 */
const STARTUP_FADE_SAMPLES = 24000;
/** Окно 25 кадров ≈ 250 мс: перегрузку надо замечать за доли секунды, а не за 5 с. */
const PERF_WINDOW_FRAMES = 25;
/** Кадр — это 10 мс звука. Дольше считать не успеваем в реальном времени. */
const FRAME_BUDGET_MS = 10;

class SampleFifo {
  constructor() {
    this.buffer = new Float32Array(FIFO_CAPACITY);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.length = 0;
    /** Отброшенные при переполнении сэмплы: на слух это ускорение речи. */
    this.dropped = 0;
  }

  push(sample) {
    this.buffer[this.writeIndex] = sample;
    this.writeIndex = (this.writeIndex + 1) % FIFO_CAPACITY;
    if (this.length < FIFO_CAPACITY) {
      this.length += 1;
    } else {
      this.readIndex = (this.readIndex + 1) % FIFO_CAPACITY;
      this.dropped += 1;
    }
  }

  prime(count) {
    this.clear();
    for (let index = 0; index < count; index += 1) this.push(0);
  }

  shift() {
    if (this.length === 0) return null;
    const sample = this.buffer[this.readIndex];
    this.readIndex = (this.readIndex + 1) % FIFO_CAPACITY;
    this.length -= 1;
    return sample;
  }

  clear() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.length = 0;
    this.dropped = 0;
  }
}

class DeepFilterNet3Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.alive = true;
    this.initializing = true;
    this.ready = false;
    this.cleaned = false;
    this.modelCreated = false;
    this.mix = 0;
    /** Пока false — обработка вводится медленно, пока модель не прогреется. */
    this.warmedUp = false;
    /** Пропущенные аудиодвижком сэмплы: единственный надёжный признак срыва. */
    this.glitchSamples = 0;
    this.lastRenderFrame = -1;
    this.lastRenderSize = 0;
    this.frameOffset = 0;
    this.frame = new Float32Array(FRAME_SIZE);
    this.dryFifo = new SampleFifo();
    this.wetFifo = new SampleFifo();
    this.perfFrames = 0;
    this.perfTotalMs = 0;
    this.perfMaxMs = 0;
    this.perfOverloadFrames = 0;
    this.now =
      typeof globalThis.performance !== 'undefined' && typeof performance.now === 'function'
        ? () => performance.now()
        : () => Date.now();

    this.port.onmessage = (event) => {
      if (event.data?.type === 'destroy') this.destroy();
    };

    const processorOptions = options?.processorOptions;
    void this.initialize(processorOptions?.wasmBinary, processorOptions?.weightsBinary);
  }

  async initialize(wasmBinary, weightsBinary) {
    try {
      if (!(wasmBinary instanceof ArrayBuffer) || !(weightsBinary instanceof ArrayBuffer)) {
        throw new Error('Бинарники DeepFilterNet3 не переданы в AudioWorklet');
      }
      if (typeof globalThis.createDFN3Module !== 'function') {
        throw new Error('createDFN3Module не загружен в AudioWorklet');
      }

      const wasmBytes = new Uint8Array(wasmBinary);
      const module = await globalThis.createDFN3Module({
        wasmBinary: wasmBytes,
        // AudioWorklet не является window/worker — обходим сломанный XHR/fetch путь glue.
        instantiateWasm: (imports, successCallback) => {
          WebAssembly.instantiate(wasmBytes, imports)
            .then(({ instance }) => successCallback(instance))
            .catch((error) => {
              this.port.postMessage({
                type: 'error',
                message: `WASM instantiate failed: ${error?.message || error}`,
              });
            });
          return {};
        },
      });
      if (!this.alive) {
        try {
          module._dfn3_wasm_destroy?.();
        } catch {
          // ignore
        }
        return;
      }

      this.module = module;
      this.weightsPointer = module._malloc(weightsBinary.byteLength);
      if (!this.weightsPointer) {
        throw new Error('Не удалось выделить память для весов DeepFilterNet3');
      }
      module.HEAPU8.set(new Uint8Array(weightsBinary), this.weightsPointer);

      if (module._dfn3_wasm_create(this.weightsPointer, weightsBinary.byteLength) !== 0) {
        throw new Error('Не удалось создать модель DeepFilterNet3');
      }
      this.modelCreated = true;
      if (!this.alive) {
        this.cleanup();
        return;
      }

      // Модель выдаёт lsnr строго внутри (-15, +35), поэтому оба крайних порога
      // намеренно выставлены на границы диапазона и отключают обе стадии-шортката:
      //   min -15 — иначе кадры с низким SNR зануляются целиком, и пропадают
      //             начала слов, тихие согласные и короткие реплики;
      //   max  35 — иначе кадры с высоким SNR уходят в эфир вообще без обработки,
      //             а это ровно щелчки клавиатуры и всплески шума.
      module._dfn3_wasm_set_min_db_thresh(-15);
      module._dfn3_wasm_set_max_db_erb_thresh(35);
      module._dfn3_wasm_set_max_db_df_thresh(20);
      // Полное подавление звучит «роботом»: оставляем -40 dB, шум на этом уровне
      // уже неразличим, а речь сохраняет естественный тембр.
      module._dfn3_wasm_set_atten_lim(40);
      module._dfn3_wasm_set_post_filter_beta(0.02);
      module._dfn3_wasm_set_hpf(1);

      this.inputPointer = module._dfn3_wasm_get_input_ptr();
      this.outputPointer = module._dfn3_wasm_get_output_ptr();
      this.initializing = false;
      // Обе очереди стартуют с одинакового запаса тишины: dry и wet остаются
      // выровненными по времени, а звук не дублируется на первых кадрах.
      this.dryFifo.prime(PRIME_SAMPLES);
      this.wetFifo.prime(PRIME_SAMPLES);
      this.frameOffset = 0;
      this.mix = 0;
      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (error) {
      this.initializing = false;
      this.cleanup();
      if (this.alive) {
        this.port.postMessage({ type: 'error', message: String(error?.message || error) });
      }
    }
  }

  cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    if (this.module && this.modelCreated) this.module._dfn3_wasm_destroy();
    if (this.module && this.weightsPointer) this.module._free(this.weightsPointer);
    this.modelCreated = false;
    this.weightsPointer = 0;
    this.module = null;
    this.dryFifo.clear();
    this.wetFifo.clear();
  }

  destroy() {
    if (!this.alive && this.cleaned) return;
    this.alive = false;
    this.ready = false;
    this.cleanup();
  }

  processFrame() {
    const startedAt = this.now();
    const module = this.module;
    module.HEAPF32.set(this.frame, this.inputPointer >> 2);
    module._dfn3_wasm_process();
    const outputOffset = this.outputPointer >> 2;

    let wetEnergy = 0;
    let dryEnergy = 0;
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      const wetSample = module.HEAPF32[outputOffset + index];
      wetEnergy += wetSample * wetSample;
      dryEnergy += this.frame[index] * this.frame[index];
      // Нули на выходе — штатный результат LSNR-гейта модели, не сбой.
      this.wetFifo.push(wetSample);
    }

    const durationMs = this.now() - startedAt;
    this.perfFrames += 1;
    this.perfTotalMs += durationMs;
    this.perfMaxMs = Math.max(this.perfMaxMs, durationMs);
    // Средний rtf прячет периодические просадки, поэтому считаем и сами просадки.
    if (durationMs > FRAME_BUDGET_MS) this.perfOverloadFrames += 1;

    if (this.perfFrames === PERF_WINDOW_FRAMES) {
      const averageMs = this.perfTotalMs / this.perfFrames;
      this.port.postMessage({
        type: 'perf',
        averageMs,
        maxMs: this.perfMaxMs,
        rtf: averageMs / FRAME_BUDGET_MS,
        overloadRatio: this.perfOverloadFrames / this.perfFrames,
        glitchSamples: this.glitchSamples,
        droppedSamples: this.dryFifo.dropped + this.wetFifo.dropped,
        lsnr: module._dfn3_wasm_get_lsnr(),
        wetRms: Math.sqrt(wetEnergy / FRAME_SIZE),
        dryRms: Math.sqrt(dryEnergy / FRAME_SIZE),
      });
      this.perfFrames = 0;
      this.perfTotalMs = 0;
      this.perfMaxMs = 0;
      this.perfOverloadFrames = 0;
      this.glitchSamples = 0;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return this.alive;

    // В AudioWorklet нет performance.now(), а Date.now() слишком груб для кадра
    // в 10 мс. Разрыв в currentFrame — прямое свидетельство того, что рендер
    // не успел и звук уже щёлкнул.
    if (this.lastRenderFrame >= 0) {
      const expected = this.lastRenderFrame + this.lastRenderSize;
      if (currentFrame > expected) this.glitchSamples += currentFrame - expected;
    }
    this.lastRenderFrame = currentFrame;
    this.lastRenderSize = output.length;

    for (let index = 0; index < output.length; index += 1) {
      const sample = input ? input[index] || 0 : 0;
      if (!this.ready) {
        output[index] = sample;
        continue;
      }

      this.frame[this.frameOffset] = sample;
      this.frameOffset += 1;
      this.dryFifo.push(sample);

      if (this.frameOffset === FRAME_SIZE) {
        this.processFrame();
        this.frameOffset = 0;
      }

      const delayedDry = this.dryFifo.shift();
      if (delayedDry === null) {
        output[index] = sample;
        continue;
      }

      // wet пустеет только если модель перестала считать — тогда плавно уходим на dry.
      const wet = this.wetFifo.shift();
      const fadeStep = this.warmedUp ? 1 / CROSSFADE_SAMPLES : 1 / STARTUP_FADE_SAMPLES;
      if (wet !== null) {
        this.mix = Math.min(1, this.mix + fadeStep);
        if (this.mix >= 1) this.warmedUp = true;
      } else {
        this.mix = Math.max(0, this.mix - 1 / FRAME_SIZE);
      }
      const processed = wet === null ? delayedDry : wet;
      output[index] = delayedDry * (1 - this.mix) + processed * this.mix;
    }

    return this.alive;
  }
}

registerProcessor('miscord-deepfilternet3', DeepFilterNet3Processor);
