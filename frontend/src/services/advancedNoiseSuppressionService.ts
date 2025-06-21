interface AdvancedNoiseSuppressionSettings {
  enabled: boolean;
  sensitivity: number; // 0-100
  mode: 'gentle' | 'balanced' | 'aggressive'; // Режимы работы
  vadEnabled: boolean; // Детектор голосовой активности
  adaptiveThreshold: boolean; // Адаптивные пороги
  bandCount: number; // Количество частотных полос (4, 8, 16)
  debugMode: boolean; // Режим отладки
}

interface NoiseSuppressionStats {
  processedFrames: number;
  sensitivity: number;
  noisePowers: number[];
  speechPowers: number[];
  avgSuppression: number;
  vadActivity: boolean;
}

class AdvancedNoiseSuppressionService {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isInitialized = false;
  private settings: AdvancedNoiseSuppressionSettings = {
    enabled: true,
    sensitivity: 75,
    mode: 'balanced',
    vadEnabled: true,
    adaptiveThreshold: true,
    bandCount: 8,
    debugMode: false
  };
  private isSettingsLoaded = false;
  private stats: NoiseSuppressionStats | null = null;

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
    if (typeof window === 'undefined') return;
    
    try {
      const saved = localStorage.getItem('advanced-noise-suppression-settings');
      if (saved) {
        const parsedSettings = JSON.parse(saved);
        this.settings = { ...this.settings, ...parsedSettings };
        
        // Принудительно включаем шумодав, если он был отключен
        if (this.settings.enabled === false) {
          console.log('🔇 Advanced шумодав был отключен в настройках, включаем его');
          this.settings.enabled = true;
          this.saveSettings(); // Сохраняем исправленные настройки
        }
      }
    } catch (error) {
      console.error('🔇 Ошибка загрузки настроек продвинутого шумодава:', error);
    }
  }

  private saveSettings() {
    if (typeof window === 'undefined') return;
    
    try {
      localStorage.setItem('advanced-noise-suppression-settings', JSON.stringify(this.settings));
    } catch (error) {
      console.error('🔇 Ошибка сохранения настроек продвинутого шумодава:', error);
    }
  }

  async initialize(audioContext: AudioContext): Promise<void> {
    this.ensureSettingsLoaded();
    this.audioContext = audioContext;
    
    // Принудительно включаем шумодав при инициализации
    if (!this.settings.enabled) {
      console.log('🔇 Advanced: Принудительно включаем шумодав при инициализации');
      this.settings.enabled = true;
      this.saveSettings();
    }
    
    try {
      console.log('🔇 Загружаем Advanced Noise Processor...');
      await this.audioContext.audioWorklet.addModule('/advanced-noise-processor.js');
      console.log('🔇 Advanced Noise Processor загружен');
      this.isInitialized = true;
    } catch (error) {
      console.error('🔇 Ошибка загрузки Advanced Noise Processor:', error);
      throw error;
    }
  }

  async processStream(inputStream: MediaStream): Promise<MediaStream> {
    this.ensureSettingsLoaded();
    
    console.log('🔇 Advanced processStream вызван:', {
      initialized: this.isInitialized,
      hasAudioContext: !!this.audioContext,
      settings: this.settings,
      inputStreamTracks: inputStream.getTracks().length,
      inputStreamActive: inputStream.active
    });

    if (!this.isInitialized || !this.audioContext) {
      console.warn('🔇 Advanced сервис не инициализирован, возвращаем оригинальный поток');
      return inputStream;
    }

    if (!this.settings.enabled) {
      console.log('🔇 Advanced шумодав отключен, возвращаем оригинальный поток');
      return inputStream;
    }

    return await this.processWithAdvancedFilter(inputStream);
  }

  private async processWithAdvancedFilter(inputStream: MediaStream): Promise<MediaStream> {
    if (!this.audioContext) {
      return inputStream;
    }

    try {
      // Создаем источник из входного потока
      const source = this.audioContext.createMediaStreamSource(inputStream);
      
      // Создаем наш продвинутый AudioWorklet узел
      this.workletNode = new AudioWorkletNode(this.audioContext, 'advanced-noise-processor', {
        processorOptions: {
          sensitivity: this.calculateEffectiveSensitivity(),
          mode: this.settings.mode,
          vadEnabled: this.settings.vadEnabled,
          bandCount: this.settings.bandCount
        }
      });

      // Настраиваем обработчики событий
      this.setupWorkletMessageHandling();

      // Создаем destination для выходного потока
      const destination = this.audioContext.createMediaStreamDestination();

      // Соединяем: источник -> Advanced Processor -> destination
      source.connect(this.workletNode);
      this.workletNode.connect(destination);

      console.log('🔇 Advanced обработка активирована с настройками:', this.settings);
      
      // Запускаем периодическое обновление статистики
      this.startStatsCollection();
      
      return destination.stream;
    } catch (error) {
      console.error('🔇 Ошибка обработки с Advanced Filter:', error);
      return inputStream;
    }
  }

  private calculateEffectiveSensitivity(): number {
    let baseSensitivity = this.settings.sensitivity;
    
    // Корректируем чувствительность в зависимости от режима
    switch (this.settings.mode) {
      case 'gentle':
        baseSensitivity = Math.max(0, baseSensitivity - 20);
        break;
      case 'aggressive':
        baseSensitivity = Math.min(100, baseSensitivity + 20);
        break;
      case 'balanced':
      default:
        // Без изменений
        break;
    }
    
    return baseSensitivity;
  }

  private setupWorkletMessageHandling() {
    if (!this.workletNode) return;

    this.workletNode.port.onmessage = (event) => {
      const { type, data } = event.data;
      
      switch (type) {
        case 'stats':
          this.stats = {
            ...data,
            avgSuppression: data.noisePowers.reduce((a: number, b: number) => a + b, 0) / data.noisePowers.length,
            vadActivity: data.processedFrames % 100 < 10 // Упрощенная логика
          };
          break;
        case 'debug':
          if (this.settings.debugMode) {
            console.log('🔇 Advanced Debug:', data);
          }
          break;
      }
    };
  }

  private startStatsCollection() {
    if (!this.workletNode) return;
    
    // Запрашиваем статистику каждые 2 секунды
    setInterval(() => {
      if (this.workletNode && this.settings.enabled) {
        this.workletNode.port.postMessage({ type: 'getStats' });
      }
    }, 2000);
  }

  // Методы для управления настройками
  setEnabled(enabled: boolean) {
    this.ensureSettingsLoaded();
    this.settings.enabled = enabled;
    this.saveSettings();
    console.log('🔇 Advanced шумодав', enabled ? 'включен' : 'выключен');
  }

  setSensitivity(sensitivity: number) {
    this.ensureSettingsLoaded();
    this.settings.sensitivity = Math.max(0, Math.min(100, sensitivity));
    this.saveSettings();
    
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setSensitivity',
        sensitivity: this.calculateEffectiveSensitivity()
      });
    }
    
    console.log('🔇 Advanced чувствительность:', this.settings.sensitivity);
  }

  setMode(mode: 'gentle' | 'balanced' | 'aggressive') {
    this.ensureSettingsLoaded();
    this.settings.mode = mode;
    this.saveSettings();
    
    // Пересчитываем и отправляем эффективную чувствительность
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setSensitivity',
        sensitivity: this.calculateEffectiveSensitivity()
      });
    }
    
    console.log('🔇 Advanced режим изменен на:', mode);
  }

  setVadEnabled(enabled: boolean) {
    this.ensureSettingsLoaded();
    this.settings.vadEnabled = enabled;
    this.saveSettings();
    
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setVadEnabled',
        enabled: enabled
      });
    }
    
    console.log('🔇 Advanced VAD', enabled ? 'включен' : 'выключен');
  }

  setAdaptiveThreshold(enabled: boolean) {
    this.ensureSettingsLoaded();
    this.settings.adaptiveThreshold = enabled;
    this.saveSettings();
    
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setAdaptiveThreshold',
        enabled: enabled
      });
    }
    
    console.log('🔇 Advanced адаптивные пороги', enabled ? 'включены' : 'выключены');
  }

  setBandCount(bandCount: number) {
    this.ensureSettingsLoaded();
    this.settings.bandCount = Math.max(4, Math.min(16, bandCount));
    this.saveSettings();
    
    // Изменение количества полос требует перезапуска процессора
    console.log('🔇 Advanced количество полос:', this.settings.bandCount, '(требует перезапуска)');
  }

  setDebugMode(enabled: boolean) {
    this.ensureSettingsLoaded();
    this.settings.debugMode = enabled;
    this.saveSettings();
    
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setDebugMode',
        enabled: enabled
      });
    }
    
    console.log('🔇 Advanced режим отладки', enabled ? 'включен' : 'выключен');
  }

  getSettings(): AdvancedNoiseSuppressionSettings {
    this.ensureSettingsLoaded();
    return { ...this.settings };
  }

  getStats(): NoiseSuppressionStats | null {
    return this.stats;
  }

  isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    
    return !!(
      window.AudioContext || 
      (window as any).webkitAudioContext
    ) && 'audioWorklet' in AudioContext.prototype;
  }

  cleanup() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    
    console.log('🔇 Advanced Noise Suppression очищен');
  }

  // Дополнительные методы для анализа
  getFrequencyAnalysis(): number[] {
    return this.stats?.noisePowers || [];
  }

  getSpeechAnalysis(): number[] {
    return this.stats?.speechPowers || [];
  }

  getRealtimeQuality(): number {
    if (!this.stats) return 0;
    
    // Вычисляем оценку качества на основе статистики
    const avgNoise = this.stats.noisePowers.reduce((a, b) => a + b, 0) / this.stats.noisePowers.length;
    const avgSpeech = this.stats.speechPowers.reduce((a, b) => a + b, 0) / this.stats.speechPowers.length;
    
    if (avgSpeech === 0) return 0;
    
    const snr = avgSpeech / (avgNoise + 0.001);
    return Math.min(100, Math.max(0, snr * 20)); // Нормализуем к 0-100
  }
}

// Создаем единственный экземпляр сервиса
const advancedNoiseSuppressionService = new AdvancedNoiseSuppressionService();

export default advancedNoiseSuppressionService;
export type { AdvancedNoiseSuppressionSettings, NoiseSuppressionStats }; 