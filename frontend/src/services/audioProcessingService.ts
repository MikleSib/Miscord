import { MicVAD, utils } from '@ricky0123/vad-web';
import { advancedNoiseGate } from './advancedNoiseGate';

export interface AudioProcessingConfig {
  vadEnabled: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  speechProbabilityThreshold: number;
  useAdvancedNoiseSuppression: boolean;
}

export class AudioProcessingService {
  private micVAD: MicVAD | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private muteGainNode: GainNode | null = null;
  private isMuted: boolean = false;
  private config: AudioProcessingConfig = {
    vadEnabled: true,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    speechProbabilityThreshold: 0.5,
    useAdvancedNoiseSuppression: false // Отключаем дополнительную обработку по умолчанию - используем браузерные алгоритмы
  };
  
  private onSpeechStart?: () => void;
  private onSpeechEnd?: () => void;
  private onVolumeChange?: (volume: number) => void;

  constructor() {
    console.log('AudioProcessingService initialized');
  }

  async initialize(stream: MediaStream): Promise<MediaStream> {
    try {
      // Создаем AudioContext
      this.audioContext = new AudioContext({ sampleRate: 48000 });
      
      // Создаем source node из входного потока
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      
      // Создаем destination node для выходного потока
      this.destinationNode = this.audioContext.createMediaStreamDestination();
      
      // Создаем mute gain node для управления микрофоном
      this.muteGainNode = this.audioContext.createGain();
      this.muteGainNode.gain.value = 1.0; // По умолчанию включен
      
      // Применяем браузерные фильтры к исходному потоку
      const processedStream = await this.applyBrowserFilters(stream);
      
      // Инициализируем VAD если включен
      if (this.config.vadEnabled) {
        await this.initializeVAD(processedStream);
      }
      
      // Строим audio pipeline с учетом настроек
      let currentNode: AudioNode = this.sourceNode;
      
      // Подключаем mute gain node в начале цепочки
      currentNode.connect(this.muteGainNode);
      currentNode = this.muteGainNode;
      
      // Добавляем продвинутую процессорную обработку если включена
      if (this.config.useAdvancedNoiseSuppression && this.config.noiseSuppression) {
        try {
          advancedNoiseGate.connectNodes(currentNode, this.destinationNode);
          console.log('🚀🔊 ДОПОЛНИТЕЛЬНАЯ ПРОЦЕССОРНАЯ ОБРАБОТКА АКТИВИРОВАНА (может не работать с WebRTC)');
        } catch (error) {
          console.error('❌ Ошибка инициализации процессорной обработки:', error);
          currentNode.connect(this.destinationNode);
        }
      } else {
        // Прямое подключение без дополнительной обработки
        currentNode.connect(this.destinationNode);
      }
      
      return this.destinationNode.stream;
    } catch (error) {
      console.error('Failed to initialize audio processing:', error);
      return stream; // Возвращаем оригинальный поток в случае ошибки
    }
  }

  private async applyBrowserFilters(stream: MediaStream): Promise<MediaStream> {
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return stream;

    const constraints = {
      echoCancellation: this.config.echoCancellation,
      noiseSuppression: this.config.noiseSuppression,
      autoGainControl: this.config.autoGainControl,
    };

    try {
      await tracks[0].applyConstraints(constraints);
    } catch (error) {
      console.warn('Failed to apply browser filters:', error);
    }

    return stream;
  }

  private async initializeVAD(stream: MediaStream): Promise<void> {
    try {
      this.micVAD = await MicVAD.new({
        stream,
        onSpeechStart: () => {
          console.log('Speech started');
          this.onSpeechStart?.();
        },
        onSpeechEnd: () => {
          console.log('Speech ended');
          this.onSpeechEnd?.();
        },
        onVADMisfire: () => {
          console.log('VAD misfire');
        },
        positiveSpeechThreshold: this.config.speechProbabilityThreshold,
        negativeSpeechThreshold: this.config.speechProbabilityThreshold - 0.15,
        redemptionFrames: 8,
        frameSamples: 1536,
        preSpeechPadFrames: 4,
        minSpeechFrames: 4,
      });

      await this.micVAD.start();
    } catch (error) {
      console.error('Failed to initialize VAD:', error);
    }
  }

  // Метод для анализа уровня громкости
  analyzeVolume(stream: MediaStream): void {
    if (!this.audioContext) return;

    const analyser = this.audioContext.createAnalyser();
    const source = this.audioContext.createMediaStreamSource(stream);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    source.connect(analyser);
    analyser.fftSize = 256;

    const checkVolume = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
      const normalizedVolume = average / 255;
      this.onVolumeChange?.(normalizedVolume);

      if (this.audioContext?.state === 'running') {
        requestAnimationFrame(checkVolume);
      }
    };

    checkVolume();
  }

  // Callback setters
  setOnSpeechStart(callback: () => void): void {
    this.onSpeechStart = callback;
  }

  setOnSpeechEnd(callback: () => void): void {
    this.onSpeechEnd = callback;
  }

  setOnVolumeChange(callback: (volume: number) => void): void {
    this.onVolumeChange = callback;
  }

  // Управление mute состоянием
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    
    if (this.muteGainNode && this.audioContext) {
      const currentTime = this.audioContext.currentTime;
      
      if (muted) {
        // Плавно заглушаем микрофон
        this.muteGainNode.gain.cancelScheduledValues(currentTime);
        this.muteGainNode.gain.setValueAtTime(this.muteGainNode.gain.value, currentTime);
        this.muteGainNode.gain.linearRampToValueAtTime(0.0, currentTime + 0.01); // 10ms для быстрого заглушения
      } else {
        // Плавно включаем микрофон
        this.muteGainNode.gain.cancelScheduledValues(currentTime);
        this.muteGainNode.gain.setValueAtTime(this.muteGainNode.gain.value, currentTime);
        this.muteGainNode.gain.linearRampToValueAtTime(1.0, currentTime + 0.01); // 10ms для быстрого включения
      }
    } else {
      console.warn('🎙️ muteGainNode или audioContext не инициализированы');
    }
  }

  // Получение текущего mute состояния
  isMute(): boolean {
    return this.isMuted;
  }

  // Обновление конфигурации
  updateConfig(config: Partial<AudioProcessingConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('Audio processing config updated:', this.config);
  }

  // Получение текущего состояния
  isSpeaking(): boolean {
    // VAD библиотека активна, если micVAD существует и не был уничтожен
    return this.micVAD !== null;
  }


  // Очистка ресурсов
  async destroy(): Promise<void> {
    if (this.micVAD) {
      await this.micVAD.destroy();
      this.micVAD = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.muteGainNode) {
      this.muteGainNode.disconnect();
      this.muteGainNode = null;
    }

    if (this.destinationNode) {
      this.destinationNode.disconnect();
      this.destinationNode = null;
    }


    // Очищаем процессоры шумоподавления
    advancedNoiseGate.destroy();

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.isMuted = false;

    console.log('Audio processing service destroyed');
  }
}

// Singleton instance
export const audioProcessingService = new AudioProcessingService(); 