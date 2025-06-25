export class RNNoiseProcessor {
  private audioContext: AudioContext | null = null;
  private rnnoiseNode: AudioWorkletNode | null = null;
  private moduleLoaded: boolean = false;
  private wasmModule: any = null;

  async initialize(audioContext: AudioContext): Promise<void> {
    this.audioContext = audioContext;
    
    try {
      // Загружаем и регистрируем AudioWorklet
      await this.loadRNNoiseWorklet();
      console.log('RNNoise worklet загружен');
    } catch (error) {
      console.error('Ошибка загрузки RNNoise:', error);
      throw error;
    }
  }

  private async loadRNNoiseWorklet(): Promise<void> {
    // Создаем код для AudioWorklet
    const workletCode = `
      class RNNoiseProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.rnnoise = null;
          this.state = null;
          this.frameSize = 480; // RNNoise требует фреймы по 480 семплов
          this.sampleRate = 48000;
          this.inputBuffer = new Float32Array(this.frameSize);
          this.outputBuffer = new Float32Array(this.frameSize);
          this.bufferIndex = 0;
          
          // Инициализация будет происходить асинхронно
          this.port.onmessage = (event) => {
            if (event.data.type === 'init') {
              this.initializeRNNoise(event.data.wasmModule);
            }
          };
        }

        initializeRNNoise(wasmModule) {
          try {
            this.rnnoise = wasmModule;
            this.state = this.rnnoise._rnnoise_create();
            console.log('RNNoise инициализирован в worklet');
            this.port.postMessage({ type: 'initialized' });
          } catch (error) {
            console.error('Ошибка инициализации RNNoise:', error);
            this.port.postMessage({ type: 'error', error: error.message });
          }
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          const output = outputs[0];

          if (!input || !input[0] || !this.rnnoise || !this.state) {
            // Если RNNoise не готов, просто копируем вход на выход
            if (input && input[0] && output && output[0]) {
              output[0].set(input[0]);
            }
            return true;
          }

          const inputChannel = input[0];
          const outputChannel = output[0];

          // Обрабатываем аудио по фреймам
          for (let i = 0; i < inputChannel.length; i++) {
            this.inputBuffer[this.bufferIndex] = inputChannel[i];
            this.bufferIndex++;

            // Когда буфер заполнен, обрабатываем фрейм
            if (this.bufferIndex >= this.frameSize) {
              // Копируем данные в WASM память
              const inputPtr = this.rnnoise._malloc(this.frameSize * 4);
              this.rnnoise.HEAPF32.set(this.inputBuffer, inputPtr / 4);

              // Обрабатываем фрейм
              const vadProb = this.rnnoise._rnnoise_process_frame(
                this.state, 
                inputPtr, 
                inputPtr
              );

              // Копируем обработанные данные обратно
              this.outputBuffer.set(
                this.rnnoise.HEAPF32.subarray(
                  inputPtr / 4, 
                  inputPtr / 4 + this.frameSize
                )
              );

              this.rnnoise._free(inputPtr);

              // Копируем обработанные данные в выходной буфер
              const startIdx = i - this.frameSize + 1;
              for (let j = 0; j < this.frameSize && startIdx + j >= 0 && startIdx + j < outputChannel.length; j++) {
                outputChannel[startIdx + j] = this.outputBuffer[j];
              }

              this.bufferIndex = 0;
            }
          }

          return true;
        }
      }

      registerProcessor('rnnoise-processor', RNNoiseProcessor);
    `;

    // Создаем blob URL для worklet
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);

    try {
      await this.audioContext!.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
  }

  async createNoiseSuppressionNode(wasmUrl: string = '/rnnoise-processor.wasm'): Promise<AudioWorkletNode | null> {
    if (!this.audioContext) {
      throw new Error('AudioContext не инициализирован');
    }

    try {
      // Загружаем WASM модуль
      const response = await fetch(wasmUrl);
      const wasmBuffer = await response.arrayBuffer();
      
      // Компилируем WASM
      const wasmModule = await WebAssembly.compile(wasmBuffer);
      const wasmInstance = await WebAssembly.instantiate(wasmModule);
      
      // Создаем AudioWorkletNode
      this.rnnoiseNode = new AudioWorkletNode(
        this.audioContext, 
        'rnnoise-processor',
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: {
            sampleRate: this.audioContext.sampleRate
          }
        }
      );

      // Отправляем WASM модуль в worklet
      this.rnnoiseNode.port.postMessage({
        type: 'init',
        wasmModule: wasmInstance.exports
      });

      // Ждем инициализации
      await new Promise((resolve, reject) => {
        this.rnnoiseNode!.port.onmessage = (event) => {
          if (event.data.type === 'initialized') {
            resolve(true);
          } else if (event.data.type === 'error') {
            reject(new Error(event.data.error));
          }
        };
      });

      console.log('RNNoise node создан и инициализирован');
      return this.rnnoiseNode;
    } catch (error) {
      console.error('Ошибка создания RNNoise node:', error);
      return null;
    }
  }

  // Альтернативный метод с использованием ScriptProcessor (устаревший, но работает везде)
  createFallbackNoiseSuppressionNode(): ScriptProcessorNode | null {
    if (!this.audioContext) {
      throw new Error('AudioContext не инициализирован');
    }

    try {
      // Импортируем RNNoise динамически
      const RNNoise = require('rnnoise-wasm');
      const rnnoise = new RNNoise();
      
      const bufferSize = 512;
      const scriptNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      let rnnoiseState: any = null;
      
      // Инициализируем RNNoise
      rnnoise.init().then(() => {
        rnnoiseState = rnnoise.create();
        console.log('RNNoise (fallback) инициализирован');
      });

      scriptNode.onaudioprocess = (event) => {
        if (!rnnoiseState) {
          // Если RNNoise не готов, копируем вход на выход
          event.outputBuffer.getChannelData(0).set(
            event.inputBuffer.getChannelData(0)
          );
          return;
        }

        const input = event.inputBuffer.getChannelData(0);
        const output = event.outputBuffer.getChannelData(0);
        
        // RNNoise обрабатывает фреймы по 480 семплов
        const frameSize = 480;
        const frames = Math.floor(input.length / frameSize);
        
        for (let i = 0; i < frames; i++) {
          const offset = i * frameSize;
          const frame = input.slice(offset, offset + frameSize);
          
          // Обрабатываем фрейм
          const processed = rnnoise.processFrame(rnnoiseState, frame);
          
          // Копируем обработанные данные
          for (let j = 0; j < frameSize && offset + j < output.length; j++) {
            output[offset + j] = processed[j];
          }
        }
        
        // Копируем оставшиеся семплы без обработки
        const remaining = input.length % frameSize;
        if (remaining > 0) {
          const offset = frames * frameSize;
          for (let i = 0; i < remaining; i++) {
            output[offset + i] = input[offset + i];
          }
        }
      };

      return scriptNode;
    } catch (error) {
      console.error('Ошибка создания fallback RNNoise node:', error);
      return null;
    }
  }

  destroy(): void {
    if (this.rnnoiseNode) {
      this.rnnoiseNode.disconnect();
      this.rnnoiseNode = null;
    }
    this.audioContext = null;
    this.moduleLoaded = false;
  }
}

export const rnnoiseProcessor = new RNNoiseProcessor(); 