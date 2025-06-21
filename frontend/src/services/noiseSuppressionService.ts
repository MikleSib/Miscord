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
  level: 'basic' | 'advanced' | 'professional'; // basic = browser native, advanced = RNNoise, professional = our advanced AI
  sensitivity: number; // 0-100
  vadThreshold: number; // Порог активации голоса в дБ (-60 до 0)
  vadEnabled: boolean; // Включить/выключить VAD
  mode?: 'gentle' | 'balanced' | 'aggressive'; // Режимы для professional уровня
}

class NoiseSuppressionService {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isInitialized = false;
  private settings: NoiseSuppressionSettings = {
    enabled: true,
    level: 'professional', // Используем наш продвинутый алгоритм по умолчанию
    sensitivity: 75,
    vadThreshold: -30, // дБ
    vadEnabled: true,
    mode: 'balanced'
  };
  private isSettingsLoaded = false;
  
  // RNNoise специфичные поля
  private rnnoiseModule: RNNoiseModule | null = null;
  private isRNNoiseLoaded = false;
  
  // Advanced AI специфичные поля
  private isAdvancedLoaded = false;

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
        // Если настройки есть, загружаем их
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      } else {
        // Если настроек нет, принудительно включаем
        console.log('🔇 Сохраненные настройки не найдены, принудительно включаем шумодав.');
        this.settings.enabled = true;
        this.saveSettings();
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

  // Принудительная очистка настроек и включение шумодава
  forceEnableNoiseSuppression() {
    console.log('🔇 Принудительно очищаем настройки и включаем шумодав');
    
    // Очищаем localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('noise-suppression-settings');
        localStorage.removeItem('advanced-noise-suppression-settings');
        console.log('🔇 Настройки очищены из localStorage');
      } catch (error) {
        console.error('🔇 Ошибка очистки localStorage:', error);
      }
    }
    
    // Принудительно включаем шумодав
    this.settings.enabled = true;
    this.settings.level = 'professional';
    this.settings.sensitivity = 75;
    this.settings.vadEnabled = true;
    this.settings.mode = 'balanced';
    
    // Сохраняем новые настройки
    this.saveSettings();
    
    console.log('🔇 Шумодав принудительно включен с настройками:', this.settings);
  }

  async initialize(audioContext: AudioContext): Promise<void> {
    this.ensureSettingsLoaded();
    this.audioContext = audioContext;
    
    // Принудительно включаем шумодав при инициализации
    if (!this.settings.enabled) {
      console.log('🔇 Принудительно включаем шумодав при инициализации');
      this.settings.enabled = true;
      this.saveSettings();
    }
    
    // Загружаем модули в зависимости от уровня
    if (this.settings.level === 'advanced') {
      console.log('🔇 Загружаем RNNoise для уровня advanced');
      await this.loadRNNoise();
    } else if (this.settings.level === 'professional') {
      console.log('🔇 Загружаем Advanced AI для уровня professional');
      await this.loadAdvancedProcessor();
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

  private async loadAdvancedProcessor(): Promise<void> {
    try {
      console.log('🔇 Загружаем Advanced AI Processor...');
      
      // Загружаем наш продвинутый AudioWorklet процессор
      if (this.audioContext) {
        await this.audioContext.audioWorklet.addModule('/advanced-noise-processor.js');
        console.log('🔇 Advanced AI Processor загружен');
        this.isAdvancedLoaded = true;
      }
    } catch (error) {
      console.error('🔇 Ошибка загрузки Advanced AI Processor:', error);
      // Fallback к RNNoise или базовому шумодаву
      this.settings.level = 'advanced';
      this.saveSettings();
      
      // Пытаемся загрузить RNNoise
      if (!this.isRNNoiseLoaded) {
        await this.loadRNNoise();
      }
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

    if (this.settings.level === 'professional') {
      console.log('🔇 Используем профессиональный уровень (Advanced AI)');
      return await this.processWithAdvancedAI(inputStream);
    }

    console.log('🔇 Используем продвинутый уровень (RNNoise)');
    // Используем RNNoise для продвинутого подавления шума
    return await this.processWithRNNoise(inputStream);
  }

  private async processWithRNNoise(inputStream: MediaStream): Promise<MediaStream> {
    if (!this.audioContext) {
      console.warn('🔇 Нет AudioContext, используем оригинальный поток');
      return inputStream;
    }

    // Принудительно загружаем RNNoise если не загружен
    if (!this.isRNNoiseLoaded) {
      console.log('🔇 RNNoise не загружен, загружаем...');
      try {
        await this.loadRNNoise();
      } catch (error) {
        console.error('🔇 Не удалось загрузить RNNoise, используем оригинальный поток:', error);
        return inputStream;
      }
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

  private async processWithAdvancedAI(inputStream: MediaStream): Promise<MediaStream> {
    if (!this.audioContext) {
      console.warn('🔇 Нет AudioContext, используем оригинальный поток');
      return inputStream;
    }

    // Принудительно загружаем Advanced AI если не загружен
    if (!this.isAdvancedLoaded) {
      console.log('🔇 Advanced AI не загружен, загружаем...');
      try {
        await this.loadAdvancedProcessor();
      } catch (error) {
        console.error('🔇 Не удалось загрузить Advanced AI, используем оригинальный поток:', error);
        return inputStream;
      }
    }

    try {
      // Создаем источник из входного потока
      const source = this.audioContext.createMediaStreamSource(inputStream);
      
      // Создаем AudioWorklet узел для нашего продвинутого процессора
      this.workletNode = new AudioWorkletNode(this.audioContext, 'advanced-noise-processor', {
        processorOptions: {
          sensitivity: this.settings.sensitivity,
          mode: this.settings.mode || 'balanced',
          vadEnabled: this.settings.vadEnabled
        }
      });

      // Создаем destination для выходного потока
      const destination = this.audioContext.createMediaStreamDestination();

      // Соединяем: источник -> Advanced AI -> destination
      source.connect(this.workletNode);
      this.workletNode.connect(destination);

      console.log('🔇 Advanced AI обработка активирована с режимом:', this.settings.mode);
      return destination.stream;
    } catch (error) {
      console.error('🔇 Ошибка обработки с Advanced AI:', error);
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

  setLevel(level: 'basic' | 'advanced' | 'professional') {
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
    
    // Если переключились на professional, загружаем Advanced AI
    if (level === 'professional' && !this.isAdvancedLoaded && this.audioContext) {
      console.log('🔇 Загружаем Advanced AI для профессионального уровня');
      this.loadAdvancedProcessor();
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

  setMode(mode: 'gentle' | 'balanced' | 'aggressive') {
    this.ensureSettingsLoaded();
    console.log('🔇 setMode вызван:', mode, 'текущие настройки:', this.settings);
    this.settings.mode = mode;
    this.saveSettings();
    
    // Обновляем режим в worklet если используется professional уровень
    if (this.workletNode && this.settings.level === 'professional') {
      this.workletNode.port.postMessage({
        type: 'setMode',
        mode: mode
      });
      console.log('🔇 Отправлено сообщение worklet о смене режима');
    }
    
    console.log('🔇 Режим шумодава изменен на:', mode, 'новые настройки:', this.settings);
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

    // Сбрасываем состояние, чтобы модули перезагрузились при следующей инициализации
    this.isInitialized = false;
    this.isRNNoiseLoaded = false;
    this.isAdvancedLoaded = false;
    this.audioContext = null; // Также сбрасываем контекст

    console.log('🔇 Сервис шумодава очищен и готов к новой инициализации');
  }

  // Получение статистики (для отладки)
  getStats() {
    return {
      initialized: this.isInitialized,
      rnnoiseLoaded: this.isRNNoiseLoaded,
      advancedLoaded: this.isAdvancedLoaded,
      settings: this.settings,
      basicSupported: this.isBasicSupported(),
      advancedSupported: this.isAdvancedSupported(),
      professionalSupported: this.isAdvancedSupported() // Профессиональный уровень требует те же возможности что и продвинутый
    };
  }
}

// Экспортируем singleton
export const noiseSuppressionService = new NoiseSuppressionService();
export default noiseSuppressionService; 