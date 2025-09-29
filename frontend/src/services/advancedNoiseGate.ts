// Продвинутый Noise Gate с анализом спектра
export class AdvancedNoiseGate {
  private audioContext: AudioContext | null = null;
  private inputGain: GainNode | null = null;
  private outputGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private lowShelf: BiquadFilterNode | null = null;
  private highPass: BiquadFilterNode | null = null;
  private highShelf: BiquadFilterNode | null = null;
  private notchFilter: BiquadFilterNode | null = null;
  private keyboardFilter: BiquadFilterNode | null = null;
  private clickFilter: BiquadFilterNode | null = null;
  private noiseGate: GainNode | null = null;
  
  // Параметры noise gate - оптимизированы для лучшего качества
  private threshold: number = 0.03; // Порог срабатывания (снижен для лучшей чувствительности)
  private attack: number = 0.001; // Время атаки (сек) - очень быстрое реагирование
  private release: number = 0.08; // Время отпускания (сек) - плавное закрытие
  private ratio: number = 15; // Соотношение подавления (сбалансированное)
  private hold: number = 0.05; // Время удержания (сек) - предотвращает мерцание
  private lookAhead: number = 0.01; // Время предварительного анализа (сек)
  
  // Буферы для анализа
  private frequencyData: Uint8Array | null = null;
  private timeData: Uint8Array | null = null;
  private isProcessing: boolean = false;
  
  // Буферы для look-ahead анализа и улучшенной обработки
  private lookAheadBuffer: Float32Array[] = [];
  private maxLookAheadSamples: number = 0;
  private gateHistory: number[] = []; // История значений gate для сглаживания
  private noiseFloor: number = 0.01; // Базовый уровень шума
  private adaptiveThreshold: number = 0.03; // Адаптивный порог
  
  // Статистика для адаптивной настройки
  private rmsHistory: number[] = [];
  private speechFrames: number = 0;
  private noiseFrames: number = 0;
  
  constructor() {
    console.log('AdvancedNoiseGate создан');
  }

  createNoiseSuppressionChain(audioContext: AudioContext): AudioNode[] {
    this.audioContext = audioContext;
    
    // Создаем узлы обработки
    this.inputGain = audioContext.createGain();
    this.outputGain = audioContext.createGain();
    this.analyser = audioContext.createAnalyser();
    this.compressor = audioContext.createDynamicsCompressor();
    this.lowShelf = audioContext.createBiquadFilter();
    this.highPass = audioContext.createBiquadFilter();
    this.highShelf = audioContext.createBiquadFilter();
    this.notchFilter = audioContext.createBiquadFilter();
    this.keyboardFilter = audioContext.createBiquadFilter();
    this.clickFilter = audioContext.createBiquadFilter();
    this.noiseGate = audioContext.createGain();
    
    // Настройка анализатора для более детального анализа
    this.analyser.fftSize = 1024; // Увеличиваем разрешение
    this.analyser.smoothingTimeConstant = 0.2; // Меньше сглаживания для быстрой реакции
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    
    // Инициализация look-ahead буфера
    this.maxLookAheadSamples = Math.ceil(this.lookAhead * audioContext.sampleRate);
    this.lookAheadBuffer = [];
    
    // Инициализация истории gate
    this.gateHistory = new Array(10).fill(1.0); // 10 последних значений
    
    // Инициализация статистики
    this.rmsHistory = new Array(100).fill(0.01); // 100 последних RMS значений
    
    // Настройка фильтра высоких частот (убирает низкочастотный шум и дыхание)
    this.highPass.type = 'highpass';
    this.highPass.frequency.value = 120; // Обрезаем частоты ниже 120 Гц (убираем дыхание)
    this.highPass.Q.value = 1.0;
    
    // Настройка полочного фильтра (ослабляет низкие частоты)
    this.lowShelf.type = 'lowshelf';
    this.lowShelf.frequency.value = 300;
    this.lowShelf.gain.value = -10; // Ослабление на 10 дБ (сильнее подавляем низкие частоты)
    
    // Настройка высокочастотного полочного фильтра (подавляет клики и высокие шумы)
    this.highShelf.type = 'highshelf';
    this.highShelf.frequency.value = 3000; // Частоты выше 3кГц (ниже порог)
    this.highShelf.gain.value = -12; // Ослабление на 12 дБ (сильнее)
    
    // Настройка режекторного фильтра (убирает специфические частоты кликов мыши)
    this.notchFilter.type = 'notch';
    this.notchFilter.frequency.value = 5000; // Типичная частота кликов мыши
    this.notchFilter.Q.value = 15; // Очень узкая полоса подавления
    
    // Дополнительный фильтр специально для клавиатуры
    this.keyboardFilter.type = 'notch';
    this.keyboardFilter.frequency.value = 3200; // Частота механической клавиатуры
    this.keyboardFilter.Q.value = 12; // Узкая полоса подавления
    
    // Третий фильтр для высокочастотных щелчков
    this.clickFilter.type = 'notch';
    this.clickFilter.frequency.value = 7500; // Высокие щелчки
    this.clickFilter.Q.value = 8; // Средняя полоса подавления
    
    // Настройка компрессора (более агрессивные настройки)
    this.compressor.threshold.value = -30; // дБ (ниже порог)
    this.compressor.knee.value = 5; // дБ (жестче переход)
    this.compressor.ratio.value = 8; // 8:1 (сильнее сжатие)
    this.compressor.attack.value = 0.001; // сек (быстрее реакция)
    this.compressor.release.value = 0.1; // сек (быстрее отпускание)
    
    // Начальные значения
    this.inputGain.gain.value = 1.0;
    this.outputGain.gain.value = 1.0;
    this.noiseGate.gain.value = 1.0;
    
    // Запускаем обработку
    this.startProcessing();
    
    // Возвращаем цепочку узлов с новыми фильтрами
    return [
      this.inputGain, 
      this.highPass, 
      this.lowShelf, 
      this.highShelf, 
      this.notchFilter,
      this.keyboardFilter,
      this.clickFilter, 
      this.noiseGate, 
      this.compressor, 
      this.outputGain
    ];
  }

  private startProcessing(): void {
    if (this.isProcessing || !this.analyser || !this.audioContext) return;
    
    this.isProcessing = true;
    let frameCount = 0;
    
    const process = () => {
      if (!this.isProcessing || !this.analyser || !this.frequencyData || !this.timeData || !this.noiseGate) {
        return;
      }
      
      // Получаем данные частотного спектра
      this.analyser.getByteFrequencyData(this.frequencyData as Uint8Array);
      this.analyser.getByteTimeDomainData(this.timeData as Uint8Array);
      
      // Анализируем уровень сигнала
      const { rms, peakLevel, speechProbability } = this.analyzeSignal();
      
      // Применяем noise gate на основе анализа
      const currentTime = this.audioContext!.currentTime;
      const targetGain = this.calculateGateGain(rms, peakLevel, speechProbability);
      
      // Логируем каждые 100 кадров (примерно 2 раза в секунду)
      if (frameCount++ % 100 === 0) {
     
      }
      
      if (targetGain > this.noiseGate.gain.value) {
        // Открываем gate (атака)
        this.noiseGate.gain.cancelScheduledValues(currentTime);
        this.noiseGate.gain.setValueAtTime(this.noiseGate.gain.value, currentTime);
        this.noiseGate.gain.linearRampToValueAtTime(targetGain, currentTime + this.attack);
      } else if (targetGain < this.noiseGate.gain.value) {
        // Закрываем gate (отпускание)
        this.noiseGate.gain.cancelScheduledValues(currentTime);
        this.noiseGate.gain.setValueAtTime(this.noiseGate.gain.value, currentTime);
        this.noiseGate.gain.exponentialRampToValueAtTime(
          Math.max(targetGain, 0.001), 
          currentTime + this.release
        );
      }
      
      // Продолжаем обработку
      if (this.audioContext!.state === 'running') {
        requestAnimationFrame(process);
      }
    };
    
    process();
  }

  private analyzeSignal(): { rms: number; peakLevel: number; speechProbability: number } {
    if (!this.frequencyData || !this.timeData) {
      return { rms: 0, peakLevel: 0, speechProbability: 0 };
    }
    
    // Вычисляем RMS (среднеквадратичное значение) с улучшенным алгоритмом
    let sum = 0;
    let peak = 0;
    let zeroCrossings = 0;
    let prevSample = 0;
    
    for (let i = 0; i < this.timeData.length; i++) {
      const sample = (this.timeData[i] - 128) / 128; // Нормализуем к [-1, 1]
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      
      // Подсчитываем пересечения нуля для определения активности
      if ((sample > 0) !== (prevSample > 0)) {
        zeroCrossings++;
      }
      prevSample = sample;
    }
    
    const rms = Math.sqrt(sum / this.timeData.length);
    
    // Обновляем историю RMS для адаптивного анализа
    this.rmsHistory.shift();
    this.rmsHistory.push(rms);
    
    // Анализ частотного спектра с улучшенной сегментацией
    let lowFreqEnergy = 0;
    let speechFreqEnergy = 0;
    let highFreqEnergy = 0;
    let noiseFreqEnergy = 0;
    
    const binWidth = this.audioContext!.sampleRate / (2 * this.frequencyData.length);
    
    for (let i = 0; i < this.frequencyData.length; i++) {
      const freq = i * binWidth;
      const magnitude = this.frequencyData[i] / 255;
      
      if (freq < 150) {
        lowFreqEnergy += magnitude * 0.3; // Очень низкие частоты (дыхание, низкочастотный шум)
      } else if (freq >= 150 && freq < 300) {
        speechFreqEnergy += magnitude * 0.8; // Низкие частоты речи
      } else if (freq >= 300 && freq < 800) {
        speechFreqEnergy += magnitude * 1.5; // Основные частоты речи
      } else if (freq >= 800 && freq < 2000) {
        speechFreqEnergy += magnitude * 1.2; // Форманты речи
      } else if (freq >= 2000 && freq < 4000) {
        speechFreqEnergy += magnitude * 0.9; // Высокие частоты речи
      } else if (freq >= 4000 && freq < 8000) {
        highFreqEnergy += magnitude * 0.6; // Очень высокие частоты (согласные)
      } else {
        noiseFreqEnergy += magnitude * 0.2; // Шумовые частоты (клики, артефакты)
      }
    }
    
    // Нормализуем энергии по количеству бинов в каждом диапазоне
    const lowBins = Math.floor(300 / binWidth);
    const speechBins = Math.floor(4000 / binWidth) - lowBins;
    const highBins = Math.floor(8000 / binWidth) - Math.floor(4000 / binWidth);
    const noiseBins = this.frequencyData.length - Math.floor(8000 / binWidth);
    
    lowFreqEnergy /= lowBins || 1;
    speechFreqEnergy /= speechBins || 1;
    highFreqEnergy /= highBins || 1;
    noiseFreqEnergy /= noiseBins || 1;
    
    // Улучшенная эвристика для определения речи
    const totalEnergy = lowFreqEnergy + speechFreqEnergy + highFreqEnergy + noiseFreqEnergy;
    const speechRatio = speechFreqEnergy / (totalEnergy + 0.001);
    const noiseRatio = noiseFreqEnergy / (totalEnergy + 0.001);
    
    // Дополнительные факторы для определения речи
    const zeroCrossingRate = zeroCrossings / this.timeData.length;
    const spectralCentroid = this.calculateSpectralCentroid();
    
    // Комбинированная вероятность речи
    let speechProbability = speechRatio * 2;
    
    // Корректируем на основе пересечений нуля (речь имеет характерные паттерны)
    if (zeroCrossingRate > 0.1 && zeroCrossingRate < 0.3) {
      speechProbability *= 1.2; // Увеличиваем вероятность речи
    }
    
    // Корректируем на основе спектрального центроида
    if (spectralCentroid > 1000 && spectralCentroid < 3000) {
      speechProbability *= 1.1; // Увеличиваем вероятность речи
    }
    
    // Штрафуем за высокий уровень шума
    if (noiseRatio > 0.3) {
      speechProbability *= 0.7;
    }
    
    // Обновляем статистику
    if (speechProbability > 0.6) {
      this.speechFrames++;
    } else {
      this.noiseFrames++;
    }
    
    // Адаптивная настройка порога
    this.updateAdaptiveThreshold();
    
    return { 
      rms, 
      peakLevel: peak, 
      speechProbability: Math.min(Math.max(speechProbability, 0), 1) 
    };
  }
  
  // Дополнительный метод для вычисления спектрального центроида
  private calculateSpectralCentroid(): number {
    if (!this.frequencyData || !this.audioContext) return 0;
    
    let weightedSum = 0;
    let magnitudeSum = 0;
    const binWidth = this.audioContext.sampleRate / (2 * this.frequencyData.length);
    
    for (let i = 0; i < this.frequencyData.length; i++) {
      const freq = i * binWidth;
      const magnitude = this.frequencyData[i] / 255;
      weightedSum += freq * magnitude;
      magnitudeSum += magnitude;
    }
    
    return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
  }
  
  // Метод для адаптивной настройки порога
  private updateAdaptiveThreshold(): void {
    if (this.rmsHistory.length < 50) return;
    
    // Вычисляем медианное значение RMS для определения уровня шума
    const sortedRMS = [...this.rmsHistory].sort((a, b) => a - b);
    const medianRMS = sortedRMS[Math.floor(sortedRMS.length / 2)];
    
    // Адаптивный порог на основе уровня шума
    this.adaptiveThreshold = Math.max(medianRMS * 2, this.threshold);
    
    // Корректируем на основе соотношения речь/шум
    const totalFrames = this.speechFrames + this.noiseFrames;
    if (totalFrames > 100) {
      const speechRatio = this.speechFrames / totalFrames;
      if (speechRatio > 0.7) {
        this.adaptiveThreshold *= 0.8; // Снижаем порог при активной речи
      } else if (speechRatio < 0.3) {
        this.adaptiveThreshold *= 1.2; // Повышаем порог при тишине
      }
      
      // Сбрасываем счетчики
      this.speechFrames = 0;
      this.noiseFrames = 0;
    }
  }

  private calculateGateGain(rms: number, peak: number, speechProbability: number): number {
    // Используем адаптивный порог вместо фиксированного
    const currentThreshold = Math.max(this.adaptiveThreshold, this.threshold);
    
    // Многофакторный анализ для определения типа сигнала
    const isPeakNoise = peak > rms * 4.0; // Импульсные шумы (клики, клавиатура)
    const isLowLevelNoise = rms < currentThreshold * 0.5; // Низкоуровневый шум
    const isHighSpeech = speechProbability > 0.7; // Высокая вероятность речи
    const isMediumSpeech = speechProbability > 0.4 && speechProbability <= 0.7; // Средняя вероятность речи
    
    // Сглаживание с использованием истории gate
    const recentGateValues = this.gateHistory.slice(-3);
    const averageRecentGate = recentGateValues.reduce((sum, val) => sum + val, 0) / recentGateValues.length;
    
    let targetGain = 1.0;
    
    if (isPeakNoise) {
      // Импульсные шумы - очень сильное подавление
      targetGain = 0.001;
    } else if (isLowLevelNoise && speechProbability < 0.3) {
      // Низкоуровневый шум с низкой вероятностью речи - сильное подавление
      targetGain = Math.pow(rms / currentThreshold, this.ratio * 1.5);
      targetGain = Math.max(targetGain, 0.01);
    } else if (isHighSpeech) {
      // Высокая вероятность речи - пропускаем полностью
      targetGain = 1.0;
    } else if (isMediumSpeech) {
      // Средняя вероятность речи - частичное пропускание с плавным переходом
      targetGain = 0.6 + (speechProbability - 0.4) * 1.33; // 0.4-0.7 -> 0.6-1.0
    } else if (rms < currentThreshold) {
      // Сигнал ниже порога - подавление
      targetGain = Math.pow(rms / currentThreshold, this.ratio);
      targetGain = Math.max(targetGain, 0.05);
    } else {
      // Неопределенный случай - умеренное пропускание
      targetGain = 0.5 + (speechProbability * 0.5);
    }
    
    // Применяем сглаживание для предотвращения мерцания
    const smoothingFactor = 0.3;
    const smoothedGain = averageRecentGate * (1 - smoothingFactor) + targetGain * smoothingFactor;
    
    // Обновляем историю gate
    this.gateHistory.shift();
    this.gateHistory.push(smoothedGain);
    
    return Math.max(smoothedGain, 0.001); // Минимальное значение для избежания полной тишины
  }

  connectNodes(source: AudioNode, destination: AudioNode): void {
    const nodes = this.createNoiseSuppressionChain(source.context as AudioContext);
    
    // Подключаем цепочку
    source.connect(nodes[0]);
    
    for (let i = 0; i < nodes.length - 1; i++) {
      nodes[i].connect(nodes[i + 1]);
    }
    
    nodes[nodes.length - 1].connect(destination);
    
    // Подключаем анализатор параллельно
    if (this.lowShelf && this.analyser) {
      this.lowShelf.connect(this.analyser);
    }
    
  }

  updateSettings(settings: {
    threshold?: number;
    attack?: number;
    release?: number;
    ratio?: number;
    highPassFreq?: number;
    lowShelfGain?: number;
  }): void {
    if (settings.threshold !== undefined) this.threshold = settings.threshold;
    if (settings.attack !== undefined) this.attack = settings.attack;
    if (settings.release !== undefined) this.release = settings.release;
    if (settings.ratio !== undefined) this.ratio = settings.ratio;
    
    if (settings.highPassFreq !== undefined && this.highPass) {
      this.highPass.frequency.value = settings.highPassFreq;
    }
    
    if (settings.lowShelfGain !== undefined && this.lowShelf) {
      this.lowShelf.gain.value = settings.lowShelfGain;
    }
  }

  destroy(): void {
    this.isProcessing = false;
    
    // Отключаем все узлы
    const nodes = [
      this.inputGain,
      this.highPass,
      this.lowShelf,
      this.highShelf,
      this.notchFilter,
      this.keyboardFilter,
      this.clickFilter,
      this.noiseGate,
      this.compressor,
      this.outputGain,
      this.analyser
    ];
    
    nodes.forEach(node => {
      if (node) {
        node.disconnect();
      }
    });
    
    // Очищаем буферы
    this.lookAheadBuffer = [];
    this.gateHistory = [];
    this.rmsHistory = [];
    
    // Сбрасываем статистику
    this.speechFrames = 0;
    this.noiseFrames = 0;
    this.noiseFloor = 0.01;
    this.adaptiveThreshold = this.threshold;
    
    // Очищаем ссылки
    this.audioContext = null;
    this.inputGain = null;
    this.outputGain = null;
    this.analyser = null;
    this.compressor = null;
    this.lowShelf = null;
    this.highPass = null;
    this.highShelf = null;
    this.notchFilter = null;
    this.keyboardFilter = null;
    this.clickFilter = null;
    this.noiseGate = null;
    this.frequencyData = null;
    this.timeData = null;
    
  }
}

export const advancedNoiseGate = new AdvancedNoiseGate(); 