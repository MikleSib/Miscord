// Public audio assets are served as immutable, so changing the query version is
// required whenever the worklet implementation changes.
const WORKLET_PATH = '/audio/deepfilternet3/dfn3-worklet.js?v=2026-08-10-primed-fifo';
const PROCESSOR_NAME = 'miscord-deepfilternet3';
const WASM_PATH = '/audio/deepfilternet3/dfn3.wasm';
const WEIGHTS_PATH = '/audio/deepfilternet3/dfn3_weights.bin';

/** Окно perf ≈ 250 мс; 4 окна подряд ≈ 1 с устойчивой перегрузки. */
const REALTIME_OVERLOAD_STRIKES = 4;
/** Доля кадров, не уложившихся в реальное время, после которой окно считается плохим. */
const OVERLOAD_FRAME_RATIO = 0.2;

type DeepFilterNet3Node = AudioWorkletNode & { destroy: () => void };

export interface DeepFilterNet3PerfMetrics {
  averageMs: number;
  maxMs: number;
  rtf: number;
  /** Доля кадров окна, обработанных дольше реального времени. */
  overloadRatio: number;
  /** Сэмплы, потерянные при переполнении очередей: на слух это ускорение речи. */
  droppedSamples: number;
  lsnr: number;
  wetRms: number;
  dryRms: number;
}

export interface DeepFilterNet3CreateOptions {
  onPerf?: (metrics: DeepFilterNet3PerfMetrics) => void;
  onRealtimeOverload?: () => void;
}

export class DeepFilterNet3NoiseSuppressor {
  private node: DeepFilterNet3Node | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private ready = false;
  private generation = 0;
  private overloadStrikes = 0;
  private preloadPromise: Promise<void> | null = null;
  private cachedWasm: ArrayBuffer | null = null;
  private cachedWeights: ArrayBuffer | null = null;

  static isSupported(): boolean {
    if (typeof window === 'undefined' || typeof WebAssembly === 'undefined' || typeof AudioWorkletNode === 'undefined' || typeof AudioContext === 'undefined' || !('audioWorklet' in AudioContext.prototype)) return false;
    try {
      const simdProbe = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);
      return WebAssembly.validate(simdProbe);
    } catch {
      return false;
    }
  }

  private async loadAsset(path: string): Promise<ArrayBuffer> {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Не удалось загрузить ${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }

  /** Заранее тянет WASM и веса (~8.5 МБ), чтобы вход в голос не ждал сеть. */
  async preload(): Promise<void> {
    if (!DeepFilterNet3NoiseSuppressor.isSupported()) return;
    if (!this.preloadPromise) {
      this.preloadPromise = (async () => {
        const [wasmBinary, weightsBinary] = await Promise.all([
          this.loadAsset(WASM_PATH),
          this.loadAsset(WEIGHTS_PATH),
        ]);
        this.cachedWasm = wasmBinary;
        this.cachedWeights = weightsBinary;
      })().catch((error) => {
        this.preloadPromise = null;
        console.warn('[DeepFilterNet3] Не удалось прогреть ассеты:', error);
      });
    }
    await this.preloadPromise;
  }

  private async getAssets(): Promise<{ wasmBinary: ArrayBuffer; weightsBinary: ArrayBuffer }> {
    if (this.cachedWasm && this.cachedWeights) {
      return {
        wasmBinary: this.cachedWasm.slice(0),
        weightsBinary: this.cachedWeights.slice(0),
      };
    }
    const [wasmBinary, weightsBinary] = await Promise.all([
      this.loadAsset(WASM_PATH),
      this.loadAsset(WEIGHTS_PATH),
    ]);
    this.cachedWasm = wasmBinary;
    this.cachedWeights = weightsBinary;
    return {
      wasmBinary: wasmBinary.slice(0),
      weightsBinary: weightsBinary.slice(0),
    };
  }

  async createNode(
    audioContext: AudioContext,
    options: DeepFilterNet3CreateOptions = {},
  ): Promise<DeepFilterNet3Node> {
    if (!DeepFilterNet3NoiseSuppressor.isSupported()) throw new Error('AudioWorklet, WebAssembly или SIMD не поддерживается');
    if (audioContext.sampleRate !== 48000) throw new Error(`DeepFilterNet3 требует 48 кГц на входе (получено ${audioContext.sampleRate} Гц)`);
    this.destroy();
    const generation = ++this.generation;
    this.ready = false;
    this.overloadStrikes = 0;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const [{ wasmBinary, weightsBinary }] = await Promise.all([
      this.getAssets(),
      audioContext.audioWorklet.addModule(WORKLET_PATH),
    ]);
    if (generation !== this.generation) throw new Error('Инициализация DeepFilterNet3 отменена');
    const magic = new Uint8Array(wasmBinary, 0, Math.min(4, wasmBinary.byteLength));
    if (magic.length !== 4 || magic[0] !== 0 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
      throw new Error('Файл DeepFilterNet3 WASM повреждён');
    }
    const node = new AudioWorkletNode(audioContext, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { wasmBinary, weightsBinary },
    }) as DeepFilterNet3Node;
    this.node = node;
    node.port.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (generation !== this.generation) return;
      if (message?.type === 'ready') {
        this.ready = true;
        this.overloadStrikes = 0;
        this.resolveReady?.();
        this.resolveReady = null;
        this.rejectReady = null;
      }
      if (message?.type === 'error') this.fail(new Error(message.message || 'Ошибка DeepFilterNet3'));
      if (message?.type === 'perf') {
        const metrics: DeepFilterNet3PerfMetrics = {
          averageMs: Number(message.averageMs) || 0,
          maxMs: Number(message.maxMs) || 0,
          rtf: Number(message.rtf) || 0,
          overloadRatio: Number(message.overloadRatio) || 0,
          droppedSamples: Number(message.droppedSamples) || 0,
          lsnr: Number(message.lsnr) || 0,
          wetRms: Number(message.wetRms) || 0,
          dryRms: Number(message.dryRms) || 0,
        };
        options.onPerf?.(metrics);
        // Средний rtf сглаживает пики, а рвут звук именно просроченные кадры.
        const overloaded =
          metrics.rtf > 1 || metrics.overloadRatio >= OVERLOAD_FRAME_RATIO;
        this.overloadStrikes = overloaded ? this.overloadStrikes + 1 : 0;
        if (this.overloadStrikes >= REALTIME_OVERLOAD_STRIKES) {
          this.overloadStrikes = 0;
          // Callback сам решает, откатываться ли (учитывая autoFallback).
          if (options.onRealtimeOverload) {
            options.onRealtimeOverload();
          } else {
            this.fail(new Error('DeepFilterNet3 устойчиво не успевает обрабатывать звук в реальном времени'));
          }
        }
      }
    };
    node.destroy = () => this.destroy();
    return node;
  }

  private fail(error: Error): void {
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.node?.port.postMessage({ type: 'worker-error' });
    if (this.node) this.node.dispatchEvent(new Event('processorerror'));
  }

  async warmUp(timeoutMs = 20000): Promise<void> {
    if (this.ready) return;
    if (!this.readyPromise) throw new Error('DeepFilterNet3 не инициализирован');
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        this.readyPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Загрузка DeepFilterNet3 заняла слишком много времени')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  destroy(): void {
    const node = this.node;
    this.node = null;
    try {
      node?.port.postMessage({ type: 'destroy' });
      node?.disconnect();
    } catch {}
    if (!this.ready) this.rejectReady?.(new Error('DeepFilterNet3 остановлен'));
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;
    this.ready = false;
    this.overloadStrikes = 0;
  }
}

export const deepFilterNet3NoiseSuppressor = new DeepFilterNet3NoiseSuppressor();
