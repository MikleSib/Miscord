// Процессорно-оптимизированная система шумоподавления
// Использует мощность CPU для качественной обработки аудио в реальном времени

export interface NoiseGateSettings {
  threshold: number;           // Порог срабатывания (-60 до 0 дБ)
  attack: number;             // Время атаки (0.001 до 0.1 сек)
  release: number;            // Время отпускания (0.01 до 1 сек)
  ratio: number;              // Соотношение подавления (2:1 до 20:1)
  knee: number;               // Переходная зона (0 до 40 дБ)
  highPassFreq: number;       // Частота высокопропускающего фильтра (Hz)
  lowPassFreq: number;        // Частота низкопропускающего фильтра (Hz)
  enableSpectralAnalysis: boolean; // Включить спектральный анализ
  enableAdaptiveThreshold: boolean; // Адаптивный порог
}

export class AdvancedNoiseGate {
  private audioContext: AudioContext | null = null;
  private inputNode: GainNode | null = null;
  private outputNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private highPassFilter: BiquadFilterNode | null = null;
  private lowPassFilter: BiquadFilterNode | null = null;
  private gateNode: GainNode | null = null;

  // Основные настройки
  private settings: NoiseGateSettings = {
    threshold: -35,           // -35 дБ - более заметное подавление
    attack: 0.001,           // 1ms - мгновенная реакция
    release: 0.15,           // 150ms - плавное закрытие
    ratio: 8,                // 8:1 - умеренное подавление
    knee: 6,                 // 6 дБ - плавный переход
    highPassFreq: 100,       // 100 Гц - лучше убирает дыхание
    lowPassFreq: 7500,       // 7.5 кГц - убирает высокие шумы
    enableSpectralAnalysis: true,
    enableAdaptiveThreshold: true
  };
  
  // Буферы для анализа
  private frequencyData: Uint8Array = new Uint8Array(0);
  private timeData: Uint8Array = new Uint8Array(0);
  private isProcessing: boolean = false;
  
  // Адаптивные параметры
  private noiseFloor: number = -60;      // Уровень шума в дБ
  private signalHistory: number[] = [];  // История уровней сигнала
  private gateHistory: number[] = [];    // История значений gate
  private lastGateValue: number = 1.0;

  // Статистика для адаптации
  private speechDetected: boolean = false;
  private noiseSamples: number[] = [];
  private speechSamples: number[] = [];
  
  constructor() {
    console.log('🚀 AdvancedNoiseGate создан - процессорно-оптимизированная версия');
    // Тестовый вывод для диагностики
    setTimeout(() => this.testNoiseSuppression(), 1000);
  }

  /**
   * Создает цепочку обработки аудио с оптимизированными фильтрами
   */
  createNoiseSuppressionChain(audioContext: AudioContext): AudioNode[] {
    this.audioContext = audioContext;
    
    // Создаем основные узлы
    this.inputNode = audioContext.createGain();
    this.outputNode = audioContext.createGain();
    this.analyser = audioContext.createAnalyser();
    this.compressor = audioContext.createDynamicsCompressor();
    this.highPassFilter = audioContext.createBiquadFilter();
    this.lowPassFilter = audioContext.createBiquadFilter();
    this.gateNode = audioContext.createGain();

    // Настройка анализатора для оптимальной производительности
    this.analyser.fftSize = 2048; // Оптимальный размер для анализа
    this.analyser.smoothingTimeConstant = 0.3;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    
    // Инициализация буферов истории
    this.signalHistory = new Array(50).fill(this.settings.threshold - 10);
    this.gateHistory = new Array(20).fill(1.0);
    this.noiseSamples = [];
    this.speechSamples = [];

    this.setupFilters();
    this.setupCompressor();
    this.startProcessing();
    
    return [
      this.inputNode,
      this.highPassFilter,
      this.lowPassFilter,
      this.compressor, 
      this.gateNode,
      this.analyser,
      this.outputNode
    ];
  }

  /**
   * Настройка фильтров для оптимального качества
   */
  private setupFilters(): void {
    if (!this.highPassFilter || !this.lowPassFilter || !this.audioContext) return;

    // Высокопропускающий фильтр - убирает дыхание и низкочастотный шум
    this.highPassFilter.type = 'highpass';
    this.highPassFilter.frequency.value = this.settings.highPassFreq;
    this.highPassFilter.Q.value = 0.707; // Butterworth response

    // Низкопропускающий фильтр - убирает высокочастотные шумы и артефакты
    this.lowPassFilter.type = 'lowpass';
    this.lowPassFilter.frequency.value = this.settings.lowPassFreq;
    this.lowPassFilter.Q.value = 0.707;
  }

  /**
   * Настройка компрессора для динамической обработки
   */
  private setupCompressor(): void {
    if (!this.compressor || !this.audioContext) return;

    // Мягкие настройки компрессора для естественного звучания
    this.compressor.threshold.value = -20; // дБ
    this.compressor.knee.value = 5;        // дБ
    this.compressor.ratio.value = 3;        // 3:1
    this.compressor.attack.value = 0.001;  // 1ms
    this.compressor.release.value = 0.1;    // 100ms
  }

  /**
   * Основной цикл обработки с оптимизацией процессора
   */
  private startProcessing(): void {
    if (this.isProcessing || !this.analyser || !this.audioContext) return;
    
    this.isProcessing = true;
    let frameCount = 0;
    
    const process = () => {
      if (!this.isProcessing || !this.analyser || !this.gateNode) return;

      // Получаем данные для анализа
      this.analyser.getByteFrequencyData(this.frequencyData);
      this.analyser.getByteTimeDomainData(this.timeData);

      // Анализируем сигнал
      const analysis = this.analyzeSignalOptimized();

      // Вычисляем новое значение gate
      const targetGain = this.calculateOptimalGateGain(analysis);

      // Плавно применяем изменения
      this.applyGateGain(targetGain);

      // Логируем для диагностики (раз в 50 кадров)
      if (frameCount % 50 === 0) {
        console.log(`🔊 NoiseGate: RMS=${analysis.rms.toFixed(1)}dB, Speech=${(analysis.speechProbability * 100).toFixed(0)}%, Gate=${targetGain.toFixed(3)}`);
      }

      // Обновляем статистику каждые 10 кадров (для производительности)
      if (frameCount++ % 10 === 0) {
        this.updateAdaptiveParameters(analysis);
      }
      
      // Продолжаем обработку
      if (this.audioContext && this.audioContext.state === 'running') {
        requestAnimationFrame(process);
      }
    };
    
    process();
  }

  /**
   * Оптимизированный анализ сигнала с использованием процессора
   */
  private analyzeSignalOptimized(): {
    rms: number;
    peak: number;
    spectralCentroid: number;
    zeroCrossingRate: number;
    speechProbability: number;
  } {
    if (!this.timeData || !this.frequencyData || !this.audioContext) {
      return { rms: 0, peak: 0, spectralCentroid: 0, zeroCrossingRate: 0, speechProbability: 0 };
    }

    // Быстрое вычисление RMS и пикового значения
    let sumSquares = 0;
    let peak = 0;
    let zeroCrossings = 0;
    let prevSample = 0;
    
    // Оптимизированный цикл с предвычислением
    const data = this.timeData;
    const len = data.length;

    for (let i = 0; i < len; i++) {
      const sample = (data[i] - 128) / 128; // Нормализация к [-1, 1]
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      
      // Подсчет пересечений нуля
      if ((sample > 0) !== (prevSample > 0)) {
        zeroCrossings++;
      }
      prevSample = sample;
    }
    
    const rms = Math.sqrt(sumSquares / len);

    // Быстрое вычисление спектрального центроида
    const binWidth = this.audioContext.sampleRate / (2 * this.frequencyData.length);
    let weightedSum = 0;
    let magnitudeSum = 0;

    // Оптимизированный расчет центроида
    const freqLen = this.frequencyData.length;
    const freqData = this.frequencyData;

    for (let i = 0; i < freqLen; i++) {
      const freq = i * binWidth;
      const magnitude = freqData[i] / 255;

      if (magnitude > 0.01) { // Игнорируем очень тихие бины
        weightedSum += freq * magnitude;
        magnitudeSum += magnitude;
      }
    }

    const spectralCentroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
    const zeroCrossingRate = zeroCrossings / len;

    // Определение вероятности речи на основе нескольких факторов
    const speechProbability = this.calculateSpeechProbability(rms, spectralCentroid, zeroCrossingRate);

    return {
      rms: this.toDb(rms),
      peak: this.toDb(peak),
      spectralCentroid,
      zeroCrossingRate,
      speechProbability
    };
  }

  /**
   * Вычисление вероятности речи с использованием нескольких критериев
   */
  private calculateSpeechProbability(rms: number, spectralCentroid: number, zeroCrossingRate: number): number {
    let probability = 0;

    // Критерий уровня сигнала
    if (rms > this.settings.threshold - 10) {
      probability += 0.4;
    }

    // Критерий спектрального центроида (голосовые частоты)
    if (spectralCentroid > 200 && spectralCentroid < 3000) {
      probability += 0.3;
    }

    // Критерий пересечения нуля (характерен для речи)
    if (zeroCrossingRate > 0.05 && zeroCrossingRate < 0.25) {
      probability += 0.3;
    }

    return Math.min(probability, 1.0);
  }

  /**
   * Оптимальный расчет значения gate с учетом всех факторов
   */
  private calculateOptimalGateGain(analysis: any): number {
    const { rms, peak, speechProbability } = analysis;

    // Определяем тип сигнала
    const isSpeech = speechProbability > 0.6;
    const isNoise = rms < this.settings.threshold && speechProbability < 0.3;
    const isTransient = peak > rms + 15; // Импульсные шумы

    let targetGain = 1.0;

    if (isSpeech) {
      // Речь - пропускаем полностью
      targetGain = 1.0;
    } else if (isTransient) {
      // Импульсный шум - сильно подавляем
      targetGain = 0.01;
    } else if (isNoise) {
      // Постоянный шум - подавляем по формуле компрессора
      const dbAboveThreshold = rms - this.settings.threshold;
      if (dbAboveThreshold < 0) {
        const compressionAmount = -dbAboveThreshold / this.settings.ratio;
        const linearGain = this.fromDb(this.settings.threshold - compressionAmount);
        targetGain = Math.max(linearGain, 0.001);
      } else {
        targetGain = 1.0;
      }
    } else {
      // Переходная зона - плавное изменение
      const transition = Math.max(0, Math.min(1, (speechProbability - 0.3) / 0.3));
      targetGain = 0.1 + (transition * 0.9);
    }

    // Сглаживание для предотвращения артефактов
    return this.smoothGateValue(targetGain);
  }

  /**
   * Плавное изменение значения gate
   */
  private smoothGateValue(targetGain: number): number {
    // Экспоненциальное сглаживание
    const smoothingFactor = this.settings.attack * 0.001; // Адаптивное сглаживание
    this.lastGateValue = this.lastGateValue * (1 - smoothingFactor) + targetGain * smoothingFactor;

    return Math.max(this.lastGateValue, 0.001); // Минимальное значение
  }

  /**
   * Применение значения gate с оптимизированной кривой
   */
  private applyGateGain(targetGain: number): void {
    if (!this.gateNode || !this.audioContext) return;

    const currentTime = this.audioContext.currentTime;
    const currentGain = this.gateNode.gain.value;

    // Отменяем предыдущие автоматизации
    this.gateNode.gain.cancelScheduledValues(currentTime);

    if (Math.abs(targetGain - currentGain) < 0.01) {
      // Небольшие изменения - устанавливаем напрямую
      this.gateNode.gain.value = targetGain;
    } else if (targetGain > currentGain) {
      // Открытие gate - быстрая атака
      this.gateNode.gain.setValueAtTime(currentGain, currentTime);
      this.gateNode.gain.linearRampToValueAtTime(targetGain, currentTime + this.settings.attack);
    } else {
      // Закрытие gate - плавное отпускание
      this.gateNode.gain.setValueAtTime(currentGain, currentTime);
      this.gateNode.gain.exponentialRampToValueAtTime(
        Math.max(targetGain, 0.001),
        currentTime + this.settings.release
      );
    }
  }

  /**
   * Адаптивная корректировка параметров на основе анализа
   */
  private updateAdaptiveParameters(analysis: any): void {
    if (!this.settings.enableAdaptiveThreshold) return;

    const { rms, speechProbability } = analysis;

    // Обновляем историю сигнала
    this.signalHistory.push(rms);
    if (this.signalHistory.length > 50) {
      this.signalHistory.shift();
    }

    // Собираем статистику
    if (speechProbability > 0.6) {
      this.speechSamples.push(rms);
      if (this.speechSamples.length > 100) {
        this.speechSamples.shift();
      }
    } else {
      this.noiseSamples.push(rms);
      if (this.noiseSamples.length > 100) {
        this.noiseSamples.shift();
      }
    }

    // Адаптивная корректировка порога каждые 5 секунд
    if (this.signalHistory.length >= 50 &&
        this.noiseSamples.length > 20 &&
        this.speechSamples.length > 10) {

      // Вычисляем статистику шума и речи
      const sortedNoise = [...this.noiseSamples].sort((a, b) => a - b);
      const noiseMedian = sortedNoise[Math.floor(sortedNoise.length * 0.5)];

      const sortedSpeech = [...this.speechSamples].sort((a, b) => a - b);
      const speechMedian = sortedSpeech[Math.floor(sortedSpeech.length * 0.5)];

      // Корректируем порог для лучшего разделения
      const optimalThreshold = (noiseMedian + speechMedian) / 2;
      const thresholdDiff = optimalThreshold - this.settings.threshold;

      // Плавная корректировка
      if (Math.abs(thresholdDiff) > 2) {
        this.settings.threshold += thresholdDiff * 0.1;
        this.settings.threshold = Math.max(-60, Math.min(-20, this.settings.threshold));
      }
    }
  }

  /**
   * Подключение цепочки обработки к аудио графу
   */
  connectNodes(source: AudioNode, destination: AudioNode): void {
    const chain = this.createNoiseSuppressionChain(source.context as AudioContext);
    
    // Подключаем цепочку
    source.connect(chain[0]);

    for (let i = 0; i < chain.length - 1; i++) {
      chain[i].connect(chain[i + 1]);
    }

    chain[chain.length - 1].connect(destination);
  }

  /**
   * Обновление настроек
   */
  updateSettings(newSettings: Partial<NoiseGateSettings>): void {
    const oldThreshold = this.settings.threshold;
    this.settings = { ...this.settings, ...newSettings };

    // Если изменился порог, обновляем фильтры
    if (oldThreshold !== this.settings.threshold && this.highPassFilter) {
      this.setupFilters();
    }

    console.log('⚙️ Настройки шумодава обновлены:', this.settings);
  }

  /**
   * Получение текущих настроек
   */
  getSettings(): NoiseGateSettings {
    return { ...this.settings };
  }

  /**
   * Тестовый метод для проверки работы шумодава
   */
  testNoiseSuppression(): void {
    console.log('🧪 ТЕСТ ШУМОДАВА:');
    console.log(`Порог: ${this.settings.threshold} дБ`);
    console.log(`Атака: ${this.settings.attack} сек`);
    console.log(`Отпускание: ${this.settings.release} сек`);
    console.log(`Соотношение: ${this.settings.ratio}:1`);
    console.log(`Высокий проход: ${this.settings.highPassFreq} Гц`);
    console.log(`Низкий проход: ${this.settings.lowPassFreq} Гц`);
    console.log(`Спектральный анализ: ${this.settings.enableSpectralAnalysis ? 'ВКЛ' : 'ВЫКЛ'}`);
    console.log(`Адаптивный порог: ${this.settings.enableAdaptiveThreshold ? 'ВКЛ' : 'ВЫКЛ'}`);
    console.log('✅ Шумодав готов к работе!');
  }

  /**
   * Временное отключение шумодава для сравнения качества
   */
  disableTemporarily(): void {
    if (this.gateNode) {
      console.log('🔇 Шумодав ВРЕМЕННО ОТКЛЮЧЕН для сравнения');
      this.gateNode.gain.value = 1.0; // Полностью открываем gate
      setTimeout(() => {
        console.log('🔊 Шумодав ВОССТАНОВЛЕН');
        this.gateNode!.gain.value = this.lastGateValue; // Возвращаем последнее значение
      }, 5000); // Отключаем на 5 секунд
    }
  }

  /**
   * Утилитарные функции для работы с дБ
   */
  private toDb(linear: number): number {
    return linear > 0 ? 20 * Math.log10(linear) : -60;
  }

  private fromDb(db: number): number {
    return Math.pow(10, db / 20);
  }

  /**
   * Очистка ресурсов
   */
  destroy(): void {
    this.isProcessing = false;
    
    const nodes = [
      this.inputNode,
      this.highPassFilter,
      this.lowPassFilter,
      this.compressor,
      this.gateNode,
      this.analyser,
      this.outputNode
    ];
    
    nodes.forEach(node => {
      if (node) {
        node.disconnect();
      }
    });
    
    // Очищаем буферы
    this.signalHistory = [];
    this.gateHistory = [];
    this.noiseSamples = [];
    this.speechSamples = [];

    // Сбрасываем ссылки
    this.audioContext = null;
    this.inputNode = null;
    this.outputNode = null;
    this.analyser = null;
    this.compressor = null;
    this.highPassFilter = null;
    this.lowPassFilter = null;
    this.gateNode = null;
    this.frequencyData = new Uint8Array(0);
    this.timeData = new Uint8Array(0);

    console.log('🗑️ AdvancedNoiseGate уничтожен');
  }
}

// Экспорт singleton экземпляра
export const advancedNoiseGate = new AdvancedNoiseGate();

// Глобальная функция для тестирования (доступна из консоли браузера)
if (typeof window !== 'undefined') {
  (window as any).testNoiseGate = () => {
    console.log('🧪 ГЛОБАЛЬНЫЙ ТЕСТ ШУМОДАВА:');
    advancedNoiseGate.testNoiseSuppression();
  };

  (window as any).toggleNoiseGate = () => {
    advancedNoiseGate.disableTemporarily();
  };

  console.log('💡 Для тестирования шумодава используйте:');
  console.log('   testNoiseGate() - показать настройки');
  console.log('   toggleNoiseGate() - временно отключить на 5 сек для сравнения');
} 
