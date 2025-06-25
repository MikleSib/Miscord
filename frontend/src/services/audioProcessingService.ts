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
  private config: AudioProcessingConfig = {
    vadEnabled: true,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    speechProbabilityThreshold: 0.5,
    useAdvancedNoiseSuppression: false
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
      
      // Применяем браузерные фильтры к исходному потоку
      const processedStream = await this.applyBrowserFilters(stream);
      
      // Инициализируем VAD если включен
      if (this.config.vadEnabled) {
        await this.initializeVAD(processedStream);
      }
      
      // Строим audio pipeline с учетом настроек
      let currentNode: AudioNode = this.sourceNode;
      
      // Добавляем продвинутое шумоподавление если включено
      if (this.config.useAdvancedNoiseSuppression && this.config.noiseSuppression) {
        try {
          // Используем AdvancedNoiseGate вместо RNNoise
          advancedNoiseGate.connectNodes(currentNode, this.destinationNode);
          console.log('Продвинутое шумоподавление (AdvancedNoiseGate) подключено');
        } catch (error) {
          console.error('Ошибка инициализации AdvancedNoiseGate:', error);
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
      console.log('Browser audio filters applied:', constraints);
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
      console.log('VAD initialized and started');
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

  // Обновление конфигурации
  updateConfig(config: Partial<AudioProcessingConfig>): void {
    const oldAdvancedNS = this.config.useAdvancedNoiseSuppression;
    this.config = { ...this.config, ...config };
    console.log('Audio processing config updated:', this.config);
    
    // Если изменилось состояние продвинутого шумоподавления, нужно переинициализировать pipeline
    if (oldAdvancedNS !== this.config.useAdvancedNoiseSuppression && this.sourceNode && this.destinationNode) {
      console.log('Переинициализация audio pipeline из-за изменения настроек шумоподавления');
      this.rebuildAudioPipeline();
    }
  }

  // Получение текущего состояния
  isSpeaking(): boolean {
    // VAD библиотека активна, если micVAD существует и не был уничтожен
    return this.micVAD !== null;
  }

  // Перестроение audio pipeline при изменении настроек
  private rebuildAudioPipeline(): void {
    if (!this.audioContext || !this.sourceNode || !this.destinationNode) {
      console.error('Невозможно перестроить pipeline: отсутствуют необходимые компоненты');
      return;
    }

    try {
      // Отключаем все существующие соединения
      this.sourceNode.disconnect();
      advancedNoiseGate.destroy();
      
      // Перестраиваем pipeline
      let currentNode: AudioNode = this.sourceNode;
      
      if (this.config.useAdvancedNoiseSuppression && this.config.noiseSuppression) {
        try {
          advancedNoiseGate.connectNodes(currentNode, this.destinationNode);
          console.log('Продвинутое шумоподавление (AdvancedNoiseGate) переподключено');
        } catch (error) {
          console.error('Ошибка переинициализации AdvancedNoiseGate:', error);
          currentNode.connect(this.destinationNode);
        }
      } else {
        // Прямое подключение без дополнительной обработки
        currentNode.connect(this.destinationNode);
        console.log('Продвинутое шумоподавление отключено, прямое подключение');
      }
    } catch (error) {
      console.error('Ошибка при перестроении audio pipeline:', error);
    }
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

    console.log('Audio processing service destroyed');
  }
}

// Singleton instance
export const audioProcessingService = new AudioProcessingService(); 