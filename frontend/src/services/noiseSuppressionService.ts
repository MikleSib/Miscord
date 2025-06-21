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
  vadThreshold: number; // Порог активации голоса в дБ (-60 до 0)
  vadEnabled: boolean; // Включить/выключить VAD
}

class NoiseSuppressionService {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isInitialized = false;
  private settings: NoiseSuppressionSettings = {
    enabled: true,
    level: 'basic',
    sensitivity: 70,
    vadThreshold: -30, // дБ
    vadEnabled: true
  };
  private isSettingsLoaded = false;
  
  // RNNoise специфичные поля
  private rnnoiseModule: RNNoiseModule | null = null;
  private isRNNoiseLoaded = false;

  constructor() {
    // Не загружаем настройки в конструкторе для SSR совместимости
  }

  private ensureSettingsLoaded() {
    if (!this.isSettingsLoaded && typeof window !== 'undefined') {
      this.loadSettings();
      this.isSettingsLoaded = true;
    }
  }

  private loadSettings() {
    // Проверяем, что мы в браузере (не на сервере)
    if (typeof window === 'undefined') return;
    
    try {
      const saved = localStorage.getItem('noise-suppression-settings');
      if (saved) {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      }
    } catch (error) {
      console.error('🔇 Ошибка загрузки настроек шумодава:', error);
    }
  }

  private saveSettings() {
    // Проверяем, что мы в браузере (не на сервере)
    if (typeof window === 'undefined') return;
    
    try {
      localStorage.setItem('noise-suppression-settings', JSON.stringify(this.settings));
    } catch (error) {
      console.error('🔇 Ошибка сохранения настроек шумодава:', error);
    }
  }

  async initialize(audioContext: AudioContext): Promise<void> {
    this.ensureSettingsLoaded();
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
    this.ensureSettingsLoaded();
    console.log('🔇 processStream вызван:', {
      initialized: this.isInitialized,
      hasAudioContext: !!this.audioContext,
      settings: this.settings,
      inputStreamTracks: inputStream.getTracks().length,
      inputStreamActive: inputStream.active
    });

    if (!this.isInitialized || !this.audioContext) {
      console.warn('🔇 Сервис шумодава не инициализирован, возвращаем оригинальный поток');
      return inputStream;
    }

    if (!this.settings.enabled) {
      console.log('🔇 Шумодав отключен, возвращаем оригинальный поток');
      return inputStream;
    }

    if (this.settings.level === 'basic') {
      console.log('🔇 Используем базовый уровень (встроенное подавление шума браузера)');
      return inputStream;
    }

    console.log('🔇 Используем продвинутый уровень (RNNoise)');
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
    this.ensureSettingsLoaded();
    console.log('🔇 setEnabled вызван:', enabled, 'текущие настройки:', this.settings);
    this.settings.enabled = enabled;
    this.saveSettings();
    console.log('🔇 Шумодав', enabled ? 'включен' : 'выключен', 'новые настройки:', this.settings);
  }

  setLevel(level: 'basic' | 'advanced') {
    this.ensureSettingsLoaded();
    console.log('🔇 setLevel вызван:', level, 'текущие настройки:', this.settings);
    this.settings.level = level;
    this.saveSettings();
    console.log('🔇 Уровень шумодава изменен на:', level, 'новые настройки:', this.settings);
    
    // Если переключились на advanced, загружаем RNNoise
    if (level === 'advanced' && !this.isRNNoiseLoaded && this.audioContext) {
      console.log('🔇 Загружаем RNNoise для продвинутого уровня');
      this.loadRNNoise();
    }
  }

  setSensitivity(sensitivity: number) {
    this.ensureSettingsLoaded();
    console.log('🔇 setSensitivity вызван:', sensitivity, 'текущие настройки:', this.settings);
    this.settings.sensitivity = Math.max(0, Math.min(100, sensitivity));
    this.saveSettings();
    
    // Обновляем чувствительность в worklet
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setSensitivity',
        sensitivity: this.settings.sensitivity
      });
      console.log('🔇 Отправлено сообщение worklet о смене чувствительности');
    }
    
    console.log('🔇 Чувствительность шумодава:', this.settings.sensitivity, 'новые настройки:', this.settings);
  }

  setVadThreshold(threshold: number) {
    this.ensureSettingsLoaded();
    console.log('🔇 setVadThreshold вызван:', threshold, 'текущие настройки:', this.settings);
    this.settings.vadThreshold = Math.max(-60, Math.min(0, threshold));
    this.saveSettings();
    console.log('🔇 Порог VAD изменен на:', this.settings.vadThreshold, 'дБ');
  }

  setVadEnabled(enabled: boolean) {
    this.ensureSettingsLoaded();
    console.log('🔇 setVadEnabled вызван:', enabled, 'текущие настройки:', this.settings);
    this.settings.vadEnabled = enabled;
    this.saveSettings();
    console.log('🔇 VAD', enabled ? 'включен' : 'выключен');
  }

  getSettings(): NoiseSuppressionSettings {
    this.ensureSettingsLoaded();
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