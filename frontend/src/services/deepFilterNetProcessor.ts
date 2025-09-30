/**
 * DeepFilterNet Processor
 * Реализация шумоподавления на основе DeepFilterNet3 с использованием ONNX Runtime
 */

import type * as ort from 'onnxruntime-web';

export interface DeepFilterNetConfig {
  modelPath: string;
  sampleRate: number;
  frameSize: number;
  enabled: boolean;
}

export class DeepFilterNetProcessor {
  private ort: typeof import('onnxruntime-web') | null = null;
  private session: ort.InferenceSession | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isInitialized: boolean = false;
  private config: DeepFilterNetConfig = {
  	modelPath: 'models/enc.onnx', // Используем encoder модель (относительный путь, чтобы работать из file:// в Electron)
    sampleRate: 48000,
    frameSize: 480, // 10ms при 48kHz
    enabled: false,
  };
  
  // Дополнительные модели DeepFilterNet3
  private encSession: ort.InferenceSession | null = null;
  private dfDecSession: ort.InferenceSession | null = null;
  private erbDecSession: ort.InferenceSession | null = null;

  // Состояние модели
  private states: Map<string, ort.Tensor> = new Map();

  constructor() {
    console.log('🎯 DeepFilterNet Processor создан');
  }

  /**
   * Инициализация ONNX модели
   */
  async initialize(audioContext: AudioContext, config?: Partial<DeepFilterNetConfig>): Promise<void> {
    if (this.isInitialized) {
      console.warn('DeepFilterNet уже инициализирован');
      return;
    }

    this.audioContext = audioContext;
    if (config) {
      this.config = { ...this.config, ...config };
    }

    try {
      console.log('🚀 Загрузка модели DeepFilterNet...');
      
      // Динамический импорт onnxruntime-web только на клиенте
      if (!this.ort) {
        const ortModule = await import('onnxruntime-web');
        // Некоторые бандлеры помещают API в default; поддержим оба варианта
        this.ort = (ortModule as any).default || (ortModule as any);
        const ortAny = this.ort as any;
        // Настройка путей к wasm
        const wasmPath = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/';
        if (typeof wasmPath === 'string' && ortAny?.env?.wasm) {
          ortAny.env.wasm.wasmPaths = wasmPath;
          // Настройка ONNX Runtime для оптимальной производительности
          ortAny.env.wasm.numThreads = 4;
          ortAny.env.wasm.simd = true;
        }
      }
      
      // Загрузка всех трех моделей DeepFilterNet3
      console.log('📦 Загрузка encoder...');
      this.encSession = await (this.ort as any).InferenceSession.create('models/enc.onnx', {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      } as any);
      
      console.log('📦 Загрузка df_decoder...');
      this.dfDecSession = await (this.ort as any).InferenceSession.create('models/df_dec.onnx', {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      } as any);
      
      console.log('📦 Загрузка erb_decoder...');
      this.erbDecSession = await (this.ort as any).InferenceSession.create('models/erb_dec.onnx', {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      } as any);

      console.log('✅ Все модели DeepFilterNet3 загружены успешно');
      console.log('Encoder входы:', this.encSession ? this.encSession.inputNames : []);
      console.log('Encoder выходы:', this.encSession ? this.encSession.outputNames : []);
      
      // Для совместимости
      this.session = this.encSession;

      // Инициализация состояний модели
      await this.initializeStates();

      // Регистрация AudioWorklet
      await this.registerWorklet();

      this.isInitialized = true;
      console.log('✅ DeepFilterNet полностью инициализирован');
    } catch (error) {
      console.error('❌ Ошибка инициализации DeepFilterNet:', error);
      throw error;
    }
  }

  /**
   * Инициализация внутренних состояний модели
   */
  private async initializeStates(): Promise<void> {
    // DeepFilterNet использует рекуррентные состояния
    // Инициализируем их нулями
    const stateSize = 256; // Размер скрытого состояния (зависит от модели)
    
    // Типы берутся из import type, конструктор из динамического модуля
    this.states.set('enc_state', new this.ort!.Tensor('float32', new Float32Array(stateSize).fill(0), [1, stateSize]));
    this.states.set('dec_state', new this.ort!.Tensor('float32', new Float32Array(stateSize).fill(0), [1, stateSize]));
  }

  /**
   * Регистрация AudioWorklet процессора
   */
  private async registerWorklet(): Promise<void> {
    if (!this.audioContext) {
      throw new Error('AudioContext не инициализирован');
    }

    const workletCode = `
      class DeepFilterNetWorklet extends AudioWorkletProcessor {
        constructor() {
          super();
          this.frameSize = 480;
          this.inputBuffer = new Float32Array(this.frameSize);
          this.outputBuffer = new Float32Array(this.frameSize);
          this.bufferIndex = 0;
          this.isProcessing = false;

          this.port.onmessage = this.handleMessage.bind(this);
        }

        handleMessage(event) {
          if (event.data.type === 'processedFrame') {
            // Получаем обработанный фрейм от главного потока
            this.outputBuffer.set(event.data.frame);
            this.isProcessing = false;
          }
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          const output = outputs[0];

          if (!input || !input[0] || !output || !output[0]) {
            return true;
          }

          const inputChannel = input[0];
          const outputChannel = output[0];

          for (let i = 0; i < inputChannel.length; i++) {
            this.inputBuffer[this.bufferIndex] = inputChannel[i];
            this.bufferIndex++;

            if (this.bufferIndex >= this.frameSize) {
              // Отправляем фрейм на обработку в главный поток
              if (!this.isProcessing) {
                this.port.postMessage({
                  type: 'processFrame',
                  frame: Array.from(this.inputBuffer)
                });
                this.isProcessing = true;
              }

              // Копируем обработанные данные в выход
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

      registerProcessor('deepfilternet-processor', DeepFilterNetWorklet);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);

    try {
      await this.audioContext.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
  }

  /**
   * Создание AudioWorklet ноды
   */
  async createProcessorNode(): Promise<AudioWorkletNode | null> {
    if (!this.isInitialized || !this.audioContext) {
      console.error('DeepFilterNet не инициализирован');
      return null;
    }

    try {
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        'deepfilternet-processor',
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        }
      );

      // Обработка сообщений от worklet
      this.workletNode.port.onmessage = async (event) => {
        if (event.data.type === 'processFrame') {
          const processedFrame = await this.processFrame(new Float32Array(event.data.frame));
          this.workletNode!.port.postMessage({
            type: 'processedFrame',
            frame: Array.from(processedFrame),
          });
        }
      };

      console.log('✅ DeepFilterNet worklet node создан');
      return this.workletNode;
    } catch (error) {
      console.error('❌ Ошибка создания worklet node:', error);
      return null;
    }
  }

  /**
   * Обработка одного фрейма аудио через модель
   */
  private async processFrame(frame: Float32Array): Promise<Float32Array> {
    if (!this.encSession || !this.dfDecSession || !this.erbDecSession) {
      return frame; // Возвращаем оригинал если модели не загружены
    }

    try {
      // УПРОЩЕННАЯ ВЕРСИЯ: Используем только encoder для базовой обработки
      // Полная реализация требует правильной конфигурации всех трех моделей
      
      // Подготовка входных данных [batch, channels, samples]
      const inputTensor = new this.ort!.Tensor('float32', frame, [1, 1, frame.length]);

      // Запуск encoder
      const encFeeds: Record<string, ort.Tensor> = {
        'input': inputTensor,
      };

      const encResults = await this.encSession.run(encFeeds);

      // Для упрощения возвращаем оригинал
      // Полная реализация требует прохода через все три модели
      console.warn('⚠️ Используется упрощенная версия DeepFilterNet. Для полной функциональности требуется дополнительная настройка.');
      
      return frame;
    } catch (error) {
      console.error('❌ Ошибка обработки фрейма:', error);
      return frame; // Возвращаем оригинал в случае ошибки
    }
  }

  /**
   * Проверка поддержки WebAssembly SIMD
   */
  static async checkSupport(): Promise<boolean> {
    try {
      // Проверка WebAssembly
      if (typeof WebAssembly === 'undefined') {
        console.warn('WebAssembly не поддерживается');
        return false;
      }

      // Проверка SIMD (опционально, но улучшает производительность)
      const simdSupported = await WebAssembly.validate(
        new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
      );

      if (!simdSupported) {
        console.warn('WebAssembly SIMD не поддерживается, производительность может быть снижена');
      }

      return true;
    } catch (error) {
      console.error('Ошибка проверки поддержки:', error);
      return false;
    }
  }

  /**
   * Сброс состояний модели
   */
  resetStates(): void {
    this.initializeStates();
    console.log('🔄 Состояния DeepFilterNet сброшены');
  }

  /**
   * Включение/выключение обработки
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled) {
      this.resetStates();
    }
  }

  /**
   * Получение статистики
   */
  getStats(): { initialized: boolean; enabled: boolean; modelLoaded: boolean } {
    return {
      initialized: this.isInitialized,
      enabled: this.config.enabled,
      modelLoaded: this.session !== null,
    };
  }

  /**
   * Очистка ресурсов
   */
  async destroy(): Promise<void> {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.encSession) {
      await this.encSession.release();
      this.encSession = null;
    }
    
    if (this.dfDecSession) {
      await this.dfDecSession.release();
      this.dfDecSession = null;
    }
    
    if (this.erbDecSession) {
      await this.erbDecSession.release();
      this.erbDecSession = null;
    }
    
    this.session = null;

    this.states.clear();
    this.isInitialized = false;
    this.audioContext = null;

    console.log('🗑️ DeepFilterNet ресурсы освобождены');
  }
}

// Singleton instance
export const deepFilterNetProcessor = new DeepFilterNetProcessor();
