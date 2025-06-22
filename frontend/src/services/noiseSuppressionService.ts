// Определяем типы прямо здесь для ясности
export interface NoiseSuppressionSettings {
  enabled: boolean;
  sensitivity: number;
  mode: 'gentle' | 'balanced' | 'aggressive';
  vadEnabled: boolean;
  vadThreshold: number; // Порог в дБ (от -100 до 0)
  adaptiveThreshold: boolean;
  bandCount: number;
  debugMode: boolean;
}

export interface NoiseSuppressionStats {
  processedFrames: number;
  noisePowers: number[];
  speechPowers: number[];
}

class UnifiedNoiseSuppressionService {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private gainNode: GainNode | null = null;
  private isInitialized = false;
  private settings: NoiseSuppressionSettings;
  private stats: NoiseSuppressionStats | null = null;
  private statsInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.settings = this.loadSettings();
  }

  private loadSettings(): NoiseSuppressionSettings {
    const defaults: NoiseSuppressionSettings = {
      enabled: true,
      sensitivity: 75,
      mode: 'balanced',
      vadEnabled: true,
      vadThreshold: -60, // Значение по умолчанию
      adaptiveThreshold: true,
      bandCount: 8,
      debugMode: false
    };

    if (typeof window === 'undefined') {
      return defaults;
    }

    try {
      const saved = localStorage.getItem('noise-suppression-settings');
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch (error) {
      console.error('🔇 Ошибка загрузки настроек шумодава:', error);
      return defaults;
    }
  }

  private saveSettings() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('noise-suppression-settings', JSON.stringify(this.settings));
    } catch (error) {
      console.error('🔇 Ошибка сохранения настроек шумодава:', error);
    }
  }
  
  async initialize(audioContext: AudioContext): Promise<void> {
    this.audioContext = audioContext;
    try {
      await this.audioContext.audioWorklet.addModule('/advanced-noise-processor.js');
      this.isInitialized = true;
      console.log('🔇 Единый сервис шумодава инициализирован');
    } catch (error) {
      console.error('🔇 Ошибка загрузки модуля advanced-noise-processor:', error);
      this.isInitialized = false;
    }
  }

  async processStream(stream: MediaStream): Promise<MediaStream> {
    if (!this.audioContext || !this.isInitialized) {
      throw new Error("Noise suppression service not initialized.");
    }
    this.cleanup();

    try {
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.destinationNode = this.audioContext.createMediaStreamDestination();
      this.workletNode = new AudioWorkletNode(this.audioContext, 'noise-suppressor');
      this.gainNode = this.audioContext.createGain();

      this.workletNode.onprocessorerror = (event) => {
        console.error('An error from noise-suppressor worklet occurred: ', event);
      };

      this.sourceNode
        .connect(this.workletNode)
        .connect(this.gainNode)
        .connect(this.destinationNode);

      return this.destinationNode.stream;
    } catch (error) {
      console.error('Error processing stream in noise suppression service: ', error);
      // Fallback to original stream
      return stream;
    }
  }
  
  private setupWorkletMessageHandling() {
    if (!this.workletNode) return;
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'stats') {
        this.stats = event.data.data;
      }
    };
  }

  private startStatsCollection() {
    this.stopStatsCollection();
    this.statsInterval = setInterval(() => {
      if (this.workletNode && this.settings.enabled) {
        this.workletNode.port.postMessage({ type: 'getStats' });
      }
    }, 1000);
  }

  private stopStatsCollection() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }
  
  setEnabled(enabled: boolean) {
    this.settings.enabled = enabled;
    this.saveSettings();
  }

  setMode(mode: NoiseSuppressionSettings['mode']) {
    this.settings.mode = mode;
    this.saveSettings();
    this.updateWorkletOptions();
  }
  
  setSensitivity(sensitivity: number) {
    this.settings.sensitivity = sensitivity;
    this.saveSettings();
    this.updateWorkletOptions();
  }
  
  setVadThreshold(threshold: number) {
    this.settings.vadThreshold = threshold;
    this.saveSettings();
    this.updateWorkletOptions();
  }
  
  private updateWorkletOptions() {
      if (this.workletNode) {
          this.workletNode.port.postMessage({ type: 'setOptions', options: this.settings });
      }
  }

  setGain(level: number) {
    if (this.gainNode) {
      // Using setTargetAtTime for a smoother transition to avoid clicks
      this.gainNode.gain.setTargetAtTime(level, this.audioContext!.currentTime, 0.01);
    }
  }

  getSettings(): NoiseSuppressionSettings {
    return this.settings;
  }
  
  getStats() {
    return this.stats;
  }
  
  getRealtimeQuality(): number {
    if (!this.stats || !this.stats.speechPowers) return 0;
    const { noisePowers, speechPowers } = this.stats;
    const avgNoise = noisePowers.reduce((a, b) => a + b, 0) / (noisePowers.length || 1);
    const avgSpeech = speechPowers.reduce((a, b) => a + b, 0) / (speechPowers.length || 1);
    if (avgSpeech === 0) return 0;
    const snr = avgSpeech / (avgNoise + 1e-6);
    return Math.min(100, Math.round(snr / 10 * 100));
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 
           typeof AudioContext !== 'undefined' && 
           'audioWorklet' in AudioContext.prototype;
  }

  cleanup() {
    this.stopStatsCollection();
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.destinationNode) {
      this.destinationNode.disconnect();
      this.destinationNode = null;
    }
    if (this.gainNode) {
      this.gainNode.gain.value = 1;
      this.gainNode = null;
    }
    this.isInitialized = false;
    console.log('🔇 Сервис шумодава очищен.');
  }
}

const noiseSuppressionService = new UnifiedNoiseSuppressionService();

export default noiseSuppressionService;
// Экспортируем только сервис, так как типы экспортируются выше
// export type { AdvancedSettings as NoiseSuppressionSettings, AdvancedStats as NoiseSuppressionStats }; 