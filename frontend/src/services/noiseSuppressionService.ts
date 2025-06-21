// Типы для RNNoise
interface RNNoiseModule {
  _rnnoise_create(): number;
  _rnnoise_destroy(state: number): void;
  _rnnoise_process_frame(state: number, output: number, input: number): number;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
}

interface NoiseSuppressionSettings {
  enabled: boolean;
  level: 'basic' | 'advanced'; // basic = browser native, advanced = RNNoise
  sensitivity: number; // 0-100
}

class NoiseSuppressionService {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isInitialized = false;
  private settings: NoiseSuppressionSettings = {
    enabled: true,
    level: 'basic',
    sensitivity: 70
  };
  
  // RNNoise специфичные поля
  private rnnoiseModule: RNNoiseModule | null = null;
  private isRNNoiseLoaded = false;

  constructor() {
    this.loadSettings();
  }

  private loadSettings() {
    const saved = localStorage.getItem('noise-suppression-settings');
    if (saved) {
      try {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      } catch (error) {
        console.error('🔇 Ошибка загрузки настроек шумодава:', error);
      }
    }
  }

  private saveSettings() {
    localStorage.setItem('noise-suppression-settings', JSON.stringify(this.settings));
  }

  async initialize(audioContext: AudioContext): Promise<void> {
    this.audioContext = audioContext;
    
    if (this.settings.level === 'advanced' && !this.isRNNoiseLoaded) {
      await this.loadRNNoise();
    }
    
    this.isInitialized = true;
    console.log('🔇 Сервис шумодава инициализирован', this.settings);
  }

  private async loadRNNoise(): Promise<void> {
    try {
      console.log('🔇 Загружаем RNNoise...');
      
      // Загружаем AudioWorklet процессор для RNNoise
      if (this.audioContext) {
        await this.audioContext.audioWorklet.addModule('/rnnoise-processor.js');
        console.log('🔇 RNNoise AudioWorklet загружен');
        this.isRNNoiseLoaded = true;
      }
    } catch (error) {
      console.error('🔇 Ошибка загрузки RNNoise:', error);
      // Fallback к базовому шумодаву
      this.settings.level = 'basic';
      this.saveSettings();
    }
  }

  async processStream(inputStream: MediaStream): Promise<MediaStream> {
    if (!this.isInitialized || !this.audioContext) {
      throw new Error('Сервис шумодава не инициализирован');
    }

    if (!this.settings.enabled) {
      return inputStream;
    }

    if (this.settings.level === 'basic') {
      // Используем встроенное подавление шума браузера
      return inputStream;
    }

    // Используем RNNoise для продвинутого подавления шума
    return await this.processWithRNNoise(inputStream);
  }

  private async processWithRNNoise(inputStream: MediaStream): Promise<MediaStream> {
    if (!this.audioContext || !this.isRNNoiseLoaded) {
      console.warn('🔇 RNNoise не загружен, используем оригинальный поток');
      return inputStream;
    }

    try {
      // Создаем источник из входного потока
      const source = this.audioContext.createMediaStreamSource(inputStream);
      
      // Создаем AudioWorklet узел для RNNoise
      this.workletNode = new AudioWorkletNode(this.audioContext, 'rnnoise-processor', {
        processorOptions: {
          sensitivity: this.settings.sensitivity
        }
      });

      // Создаем destination для выходного потока
      const destination = this.audioContext.createMediaStreamDestination();

      // Соединяем: источник -> RNNoise -> destination
      source.connect(this.workletNode);
      this.workletNode.connect(destination);

      console.log('🔇 RNNoise обработка активирована');
      return destination.stream;
    } catch (error) {
      console.error('🔇 Ошибка обработки с RNNoise:', error);
      return inputStream;
    }
  }

  // Методы для управления настройками
  setEnabled(enabled: boolean) {
    this.settings.enabled = enabled;
    this.saveSettings();
    console.log('🔇 Шумодав', enabled ? 'включен' : 'выключен');
  }

  setLevel(level: 'basic' | 'advanced') {
    this.settings.level = level;
    this.saveSettings();
    console.log('🔇 Уровень шумодава изменен на:', level);
    
    // Если переключились на advanced, загружаем RNNoise
    if (level === 'advanced' && !this.isRNNoiseLoaded && this.audioContext) {
      this.loadRNNoise();
    }
  }

  setSensitivity(sensitivity: number) {
    this.settings.sensitivity = Math.max(0, Math.min(100, sensitivity));
    this.saveSettings();
    
    // Обновляем чувствительность в worklet
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setSensitivity',
        sensitivity: this.settings.sensitivity
      });
    }
    
    console.log('🔇 Чувствительность шумодава:', this.settings.sensitivity);
  }

  getSettings(): NoiseSuppressionSettings {
    return { ...this.settings };
  }

  // Методы для получения информации о поддержке
  isBasicSupported(): boolean {
    return 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices;
  }

  isAdvancedSupported(): boolean {
    return 'AudioWorklet' in window && 'audioWorklet' in AudioContext.prototype;
  }

  // Очистка ресурсов
  cleanup() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    
    this.isInitialized = false;
    console.log('🔇 Сервис шумодава очищен');
  }

  // Получение статистики (для отладки)
  getStats() {
    return {
      initialized: this.isInitialized,
      rnnoiseLoaded: this.isRNNoiseLoaded,
      settings: this.settings,
      basicSupported: this.isBasicSupported(),
      advancedSupported: this.isAdvancedSupported()
    };
  }
}

// Экспортируем singleton
export const noiseSuppressionService = new NoiseSuppressionService();
export default noiseSuppressionService; 