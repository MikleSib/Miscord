import { MicVAD, utils } from '@ricky0123/vad-web';
import { advancedNoiseGate } from './advancedNoiseGate';
import { deepFilterNetProcessor } from './deepFilterNetProcessor';

export type NoiseSuppressionEngine = 'browser' | 'rnnoise' | 'deepfilternet';

export interface AudioProcessingConfig {
  vadEnabled: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  speechProbabilityThreshold: number;
  useAdvancedNoiseSuppression: boolean;
  noiseSuppressionEngine: NoiseSuppressionEngine;
}

export class AudioProcessingService {
  private micVAD: MicVAD | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private muteGainNode: GainNode | null = null;
  private isMuted: boolean = false;
  private analyser: AnalyserNode | null = null;
  private config: AudioProcessingConfig = {
    vadEnabled: true,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    speechProbabilityThreshold: 0.5,
    useAdvancedNoiseSuppression: true, // Включаем CPU-обработку по умолчанию
    noiseSuppressionEngine: (typeof window !== 'undefined' && (
      // Electron окружение
      !!(window as any).electronAPI || (navigator && /Electron/i.test(navigator.userAgent))
    )) ? 'deepfilternet' : 'browser' // В Electron сразу используем DeepFilterNet
  };
  
  private deepFilterNetNode: AudioWorkletNode | null = null;
  private deepFilterNetSupported: boolean = false;
  
  private onSpeechStart?: () => void;
  private onSpeechEnd?: () => void;
  private onVolumeChange?: (volume: number) => void;

  constructor() {
    console.log('AudioProcessingService initialized');
    this.checkDeepFilterNetSupport();
  }

  /**
   * Проверка поддержки DeepFilterNet
   */
  private async checkDeepFilterNetSupport(): Promise<void> {
    try {
      const { DeepFilterNetProcessor } = await import('./deepFilterNetProcessor');
      const supported = await DeepFilterNetProcessor.checkSupport();
      this.deepFilterNetSupported = supported;
      if (supported) {
        console.log('✅ DeepFilterNet поддерживается на этом устройстве');
      } else {
        console.warn('⚠️ DeepFilterNet не поддерживается, используйте браузерные фильтры');
      }
    } catch (error) {
      console.error('Ошибка проверки поддержки DeepFilterNet:', error);
      this.deepFilterNetSupported = false;
    }
  }

  /**
   * Получение информации о поддержке движков
   */
  getSupportedEngines(): { engine: NoiseSuppressionEngine; supported: boolean; name: string }[] {
    return [
      { engine: 'browser', supported: true, name: 'Браузерные фильтры' },
      { engine: 'rnnoise', supported: true, name: 'RNNoise (базовый)' },
    ];
  }

  // Метод для обновления порогов VAD
  updateVADThresholds(sensitivity: number): void {
    console.log('🎙️ AudioProcessingService: Обновление порогов VAD:', sensitivity);
    
    // Конвертируем чувствительность 0-100 в порог 0.1-0.9
    // 0 = максимально чувствительный (0.1), 100 = минимально чувствительный (0.9)
    const normalizedSensitivity = sensitivity / 100; // 0-1
    const newThreshold = 0.1 + (0.8 * normalizedSensitivity); // 0.1-0.9
    
    this.config.speechProbabilityThreshold = newThreshold;
    
    // Перезапускаем VAD с новыми порогами
    if (this.micVAD) {
      this.micVAD.destroy();
      this.micVAD = null;
      
      // Если есть исходный поток, переинициализируем VAD
      if (this.sourceNode && this.sourceNode.mediaStream) {
        this.initializeVAD(this.sourceNode.mediaStream);
      }
    }
    
    console.log('🎙️ AudioProcessingService: Новый порог VAD:', newThreshold.toFixed(2));
  }

  // Метод для получения текущего уровня громкости
  getCurrentVolume(): number {
    if (!this.analyser) {
      return 0;
    }

    try {
      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      this.analyser.getByteFrequencyData(dataArray);
      
      let totalSum = 0;
      for (let i = 0; i < bufferLength; i++) {
        totalSum += dataArray[i];
      }
      
      const average = totalSum / bufferLength;
      return Math.min(100, (average / 255) * 100);
    } catch (error) {
      console.error('Ошибка получения уровня громкости:', error);
      return 0;
    }
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
      
      // Выбор движка шумоподавления
      if (this.config.noiseSuppression && this.config.noiseSuppressionEngine === 'deepfilternet' && this.deepFilterNetSupported) {
        // Используем DeepFilterNet
        try {
          await deepFilterNetProcessor.initialize(this.audioContext);
          this.deepFilterNetNode = await deepFilterNetProcessor.createProcessorNode();
          
          if (this.deepFilterNetNode) {
            currentNode.connect(this.deepFilterNetNode);
            this.deepFilterNetNode.connect(this.destinationNode);
            console.log('🎯 DeepFilterNet активирован');
          } else {
            console.warn('⚠️ Не удалось создать DeepFilterNet node, используем fallback');
            currentNode.connect(this.destinationNode);
          }
        } catch (error) {
          console.error('❌ Ошибка инициализации DeepFilterNet:', error);
          currentNode.connect(this.destinationNode);
        }
      } else if (this.config.useAdvancedNoiseSuppression && this.config.noiseSuppression && this.config.noiseSuppressionEngine === 'rnnoise') {
        // Используем RNNoise/продвинутую обработку
        try {
          advancedNoiseGate.connectNodes(currentNode, this.destinationNode);
          console.log('🚀 RNNoise/Advanced обработка активирована');
        } catch (error) {
          console.error('❌ Ошибка инициализации RNNoise:', error);
          currentNode.connect(this.destinationNode);
        }
      } else {
        // Прямое подключение (браузерные фильтры)
        currentNode.connect(this.destinationNode);
        console.log('🔊 Используются браузерные фильтры');
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

    this.analyser = this.audioContext.createAnalyser();
    const source = this.audioContext.createMediaStreamSource(stream);
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    source.connect(this.analyser);
    this.analyser.fftSize = 256;

    const checkVolume = () => {
      if (!this.analyser) return;
      
      this.analyser.getByteFrequencyData(dataArray);
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
    const oldNoiseSuppression = this.config.noiseSuppression;
    const oldEchoCancellation = this.config.echoCancellation;
    const oldAutoGainControl = this.config.autoGainControl;
    const oldEngine = this.config.noiseSuppressionEngine;

    this.config = { ...this.config, ...config };
    console.log('Audio processing config updated:', this.config);

    // Если изменился движок шумоподавления, нужно переинициализировать
    if (oldEngine !== this.config.noiseSuppressionEngine) {
      console.log('🔄 Движок шумоподавления изменен, требуется переинициализация');
      // Здесь можно добавить логику переинициализации или уведомить пользователя
    }

    // Если изменились настройки шумоподавления, эха или АРУ, нужно обновить браузерные настройки
    if (oldNoiseSuppression !== this.config.noiseSuppression ||
        oldEchoCancellation !== this.config.echoCancellation ||
        oldAutoGainControl !== this.config.autoGainControl) {
      console.log('🔄 Обновляем браузерные настройки аудио...');
      this.updateBrowserAudioConstraints();
    }

    // Обновляем состояние DeepFilterNet если он используется
    if (this.config.noiseSuppressionEngine === 'deepfilternet') {
      deepFilterNetProcessor.setEnabled(this.config.noiseSuppression);
    }
  }

  // Обновление браузерных настроек аудио
  private async updateBrowserAudioConstraints(): Promise<void> {
    try {
      if (this.audioContext && this.sourceNode) {
        // Получаем текущий медиа поток
        const stream = this.sourceNode.mediaStream;
        if (stream) {
          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length > 0) {
            const track = audioTracks[0];

            // Применяем новые настройки к треку
            await track.applyConstraints({
              echoCancellation: this.config.echoCancellation,
              noiseSuppression: this.config.noiseSuppression,
              autoGainControl: this.config.autoGainControl,
            });

            console.log('✅ Браузерные настройки аудио обновлены');
          }
        }
      }
    } catch (error) {
      console.error('❌ Ошибка обновления браузерных настроек аудио:', error);
    }
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

    if (this.deepFilterNetNode) {
      this.deepFilterNetNode.disconnect();
      this.deepFilterNetNode = null;
    }

    if (this.destinationNode) {
      this.destinationNode.disconnect();
      this.destinationNode = null;
    }

    // Очищаем процессоры шумоподавления
    advancedNoiseGate.destroy();
    await deepFilterNetProcessor.destroy();

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
