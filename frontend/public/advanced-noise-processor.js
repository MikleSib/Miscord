// Advanced Noise Suppression Processor
// Разработано для Miscord - конкурент Krisp
class AdvancedNoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    
    this.frameSize = 128; // Оптимальный размер для веб-аудио
    this.sampleRate = sampleRate || 48000;
    this.sensitivity = options.processorOptions?.sensitivity || 70;
    
    // Буферы для анализа
    this.inputBuffer = new Float32Array(this.frameSize);
    this.outputBuffer = new Float32Array(this.frameSize);
    this.bufferIndex = 0;
    
    // Многополосный анализ (увеличиваем до 16 полос для лучшей точности)
    this.bands = 16;
    this.bandFilters = [];
    this.bandBuffers = [];
    this.initializeBandFilters();
    
    // Спектральный анализ
    this.fftSize = 512; // Увеличиваем для лучшего разрешения
    this.hopSize = 128;
    this.window = this.createHammingWindow(this.fftSize);
    this.prevFrame = new Float32Array(this.fftSize);
    this.overlapBuffer = new Float32Array(this.hopSize);
    
    // Адаптивные пороги для каждой полосы
    this.noisePowers = new Float32Array(this.bands).fill(0.0001);
    this.speechPowers = new Float32Array(this.bands).fill(0.001);
    this.adaptationRates = new Float32Array(this.bands).fill(0.01); // Быстрее адаптация
    
    // Детектор голосовой активности (VAD) - улучшенный
    this.vadHistory = new Array(20).fill(0); // Больше истории
    this.vadThreshold = 0.25; // Более чувствительный
    this.silenceFrames = 0;
    this.speechFrames = 0;
    
    // Сглаживание коэффициентов подавления
    this.smoothingFactors = new Float32Array(this.bands).fill(1.0);
    this.prevSmoothingFactors = new Float32Array(this.bands).fill(1.0);
    this.smoothingRate = 0.3; // Быстрее реакция
    
    // Noise Gate для слабых сигналов
    this.noiseGateThreshold = 0.001;
    this.noiseGateRatio = 0.1;
    
    // Статистика
    this.processedFrames = 0;
    this.totalNoiseSuppressed = 0;
    this.qualityScore = 100;
    this.isInitialized = true;
    
    console.log('🔇 Advanced Noise Processor v2.0 инициализирован с улучшенным алгоритмом');
    
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }
  
  handleMessage(data) {
    switch (data.type) {
      case 'setSensitivity':
        this.sensitivity = Math.max(0, Math.min(100, data.sensitivity));
        this.updateSensitivity();
        console.log('🔇 Обновлена чувствительность:', this.sensitivity);
        break;
      case 'setOptions':
        if (data.options) {
          this.sensitivity = data.options.sensitivity || this.sensitivity;
          this.updateSensitivity();
          console.log('🔇 Обновлены настройки шумодава:', data.options);
        }
        break;
      case 'getStats':
        this.port.postMessage({
          type: 'stats',
          data: {
            processedFrames: this.processedFrames,
            sensitivity: this.sensitivity,
            qualityScore: Math.round(this.qualityScore),
            totalNoiseSuppressed: this.totalNoiseSuppressed,
            speechFrames: this.speechFrames,
            silenceFrames: this.silenceFrames,
            noisePowers: Array.from(this.noisePowers),
            speechPowers: Array.from(this.speechPowers)
          }
        });
        break;
    }
  }
  
  initializeBandFilters() {
    // Создаем полосовые фильтры (IIR фильтры Баттерворта)
    const nyquist = this.sampleRate / 2;
    const bandWidth = nyquist / this.bands;
    
    for (let i = 0; i < this.bands; i++) {
      const lowFreq = i * bandWidth;
      const highFreq = (i + 1) * bandWidth;
      
      this.bandFilters.push({
        // Простой полосовой фильтр (можно заменить на более сложный)
        lowFreq: lowFreq,
        highFreq: highFreq,
        prevInput: 0,
        prevOutput: 0,
        // Коэффициенты фильтра (упрощенные)
        a: Math.exp(-2 * Math.PI * highFreq / this.sampleRate),
        b: Math.exp(-2 * Math.PI * lowFreq / this.sampleRate)
      });
      
      this.bandBuffers.push(new Float32Array(this.frameSize));
    }
  }
  
  createHammingWindow(size) {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (size - 1));
    }
    return window;
  }
  
  updateSensitivity() {
    const normalizedSensitivity = this.sensitivity / 100;
    
    // Обновляем пороги в зависимости от чувствительности
    for (let i = 0; i < this.bands; i++) {
      // Более высокая частота - более агрессивное подавление
      const freqFactor = (i + 1) / this.bands;
      this.adaptationRates[i] = 0.0005 + normalizedSensitivity * 0.002 * freqFactor;
    }
    
    this.vadThreshold = 0.2 + normalizedSensitivity * 0.3;
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (!input || !output || input.length === 0 || output.length === 0) {
      return true;
    }
    
    const inputChannel = input[0];
    const outputChannel = output[0];
    
    if (!inputChannel || !outputChannel) {
      return true;
    }
    
    this.processAdvanced(inputChannel, outputChannel);
    
    return true;
  }
  
  processAdvanced(inputChannel, outputChannel) {
    // 1. Многополосный анализ
    const bandPowers = this.analyzeBands(inputChannel);
    
    // 2. Детекция голосовой активности
    const isVoiceActive = this.detectVoiceActivity(bandPowers);
    
    // 3. Адаптивное обновление моделей шума и речи
    this.updateNoiseModels(bandPowers, isVoiceActive);
    
    // 4. Вычисление коэффициентов подавления для каждой полосы
    const suppressionFactors = this.calculateSuppressionFactors(bandPowers);
    
    // 5. Применение спектрального вычитания
    this.applySpectralSubtraction(inputChannel, outputChannel, suppressionFactors);
    
    // 6. Пост-обработка
    this.postProcess(outputChannel);
    
    this.processedFrames++;
    
    // Улучшенное логирование статистики
    if (this.processedFrames % 1000 === 0) {
      const avgSuppression = suppressionFactors.reduce((a, b) => a + b, 0) / suppressionFactors.length;
      const minSuppression = Math.min(...suppressionFactors);
      const maxSuppression = Math.max(...suppressionFactors);
      const qualityPercent = Math.round(this.qualityScore);
      
      console.log(`🔇 Advanced v2.0: VAD=${isVoiceActive}, подавление=${avgSuppression.toFixed(3)} (${minSuppression.toFixed(3)}-${maxSuppression.toFixed(3)}), качество=${qualityPercent}%, чувствительность=${this.sensitivity}%`);
      
      // Дополнительная диагностика при низком качестве
      if (qualityPercent < 50) {
        console.warn(`🔇 Низкое качество! Речь=${this.speechFrames}, молчание=${this.silenceFrames}, общее подавление=${(this.totalNoiseSuppressed/this.processedFrames*100).toFixed(1)}%`);
      }
    }
  }
  
  analyzeBands(inputChannel) {
    const bandPowers = new Float32Array(this.bands);
    
    // Применяем полосовые фильтры и вычисляем мощность
    for (let band = 0; band < this.bands; band++) {
      const filter = this.bandFilters[band];
      const buffer = this.bandBuffers[band];
      let power = 0;
      
      for (let i = 0; i < inputChannel.length; i++) {
        // Простой полосовой фильтр (IIR)
        const input = inputChannel[i];
        const output = filter.b * input + filter.a * filter.prevOutput;
        filter.prevInput = input;
        filter.prevOutput = output;
        
        buffer[i] = output;
        power += output * output;
      }
      
      bandPowers[band] = power / inputChannel.length;
    }
    
    return bandPowers;
  }
  
  detectVoiceActivity(bandPowers) {
    // Анализируем распределение энергии по частотам
    const totalPower = bandPowers.reduce((sum, power) => sum + power, 0);
    
    if (totalPower < 0.00001) {
      this.silenceFrames++;
      return false;
    }
    
    // Улучшенный анализ речевых характеристик
    // Голос имеет характерное распределение энергии
    const lowBands = bandPowers.slice(0, this.bands / 4);  // 0-25% частот
    const midBands = bandPowers.slice(this.bands / 4, 3 * this.bands / 4);  // 25-75% частот  
    const highBands = bandPowers.slice(3 * this.bands / 4);  // 75-100% частот
    
    const lowPower = lowBands.reduce((sum, power) => sum + power, 0);
    const midPower = midBands.reduce((sum, power) => sum + power, 0);
    const highPower = highBands.reduce((sum, power) => sum + power, 0);
    
    // Речь обычно имеет больше энергии в средних частотах
    const speechRatio = midPower / (totalPower + 0.00001);
    
    // Проверяем соотношение низких к высоким частотам (речь vs шум)
    const lowHighRatio = lowPower / (highPower + 0.00001);
    
    // Детектор основной частоты (улучшенный)
    const f0Strength = this.detectF0(bandPowers);
    
    // Детектор стабильности энергии (речь более стабильна чем импульсный шум)
    const energyStability = this.detectEnergyStability(bandPowers);
    
    // Детектор периодичности (речь имеет периодическую структуру)
    const periodicity = this.detectPeriodicity(bandPowers);
    
    // Комбинированный детектор с весами
    const vadScore = 
      speechRatio * 0.3 +           // Частотное распределение
      f0Strength * 0.25 +           // Основной тон
      energyStability * 0.2 +       // Стабильность
      periodicity * 0.15 +          // Периодичность
      Math.min(lowHighRatio, 2) * 0.1; // Соотношение частот
    
    // Адаптивный порог на основе недавней активности
    let adaptiveThreshold = this.vadThreshold;
    const recentSilence = this.silenceFrames / (this.silenceFrames + this.speechFrames + 1);
    if (recentSilence > 0.8) {
      // Если долго молчим, снижаем порог
      adaptiveThreshold *= 0.8;
    }
    
    // Сглаживание по времени с гистерезисом
    const isCurrentlyActive = vadScore > adaptiveThreshold;
    this.vadHistory.shift();
    this.vadHistory.push(isCurrentlyActive ? 1 : 0);
    
    const recentActivity = this.vadHistory.reduce((sum, val) => sum + val, 0);
    const activityRatio = recentActivity / this.vadHistory.length;
    
    // Гистерезис: легче остаться в текущем состоянии
    const wasActive = this.vadHistory[this.vadHistory.length - 2] === 1;
    let isActive;
    
    if (wasActive) {
      // Если говорили, нужно больше молчания чтобы остановиться
      isActive = activityRatio > 0.2;
    } else {
      // Если молчали, нужно больше активности чтобы начать
      isActive = activityRatio > 0.4;
    }
    
    if (isActive) {
      this.speechFrames++;
    } else {
      this.silenceFrames++;
    }
    
    return isActive;
  }
  
  detectF0(bandPowers) {
    // Улучшенный детектор основного тона
    let harmonicStrength = 0;
    let peakCount = 0;
    
    // Ищем локальные максимумы (возможные гармоники)
    for (let i = 2; i < this.bands - 2; i++) {
      const current = bandPowers[i];
      const prev2 = bandPowers[i - 2];
      const prev1 = bandPowers[i - 1];
      const next1 = bandPowers[i + 1];
      const next2 = bandPowers[i + 2];
      
      // Локальный максимум
      if (current > prev1 && current > next1 && current > prev2 && current > next2) {
        const prominence = current / (Math.max(prev1, next1) + 0.00001);
        if (prominence > 1.3) {
          harmonicStrength += prominence;
          peakCount++;
        }
      }
    }
    
    // Проверяем гармонические отношения между пиками
    if (peakCount >= 2) {
      harmonicStrength *= 1.5; // Бонус за множественные гармоники
    }
    
    return Math.min(harmonicStrength / (this.bands * 2), 1.0);
  }
  
  detectEnergyStability(bandPowers) {
    // Детектор стабильности энергии - речь более стабильна чем импульсный шум
    if (!this.prevFrame || this.prevFrame.length !== bandPowers.length) {
      this.prevFrame = new Float32Array(bandPowers);
      return 0.5;
    }
    
    let stability = 0;
    for (let i = 0; i < bandPowers.length; i++) {
      const current = bandPowers[i];
      const previous = this.prevFrame[i];
      
      if (current > 0.00001 && previous > 0.00001) {
        const ratio = Math.min(current, previous) / Math.max(current, previous);
        stability += ratio;
      }
    }
    
    // Обновляем предыдущий кадр
    for (let i = 0; i < bandPowers.length; i++) {
      this.prevFrame[i] = bandPowers[i];
    }
    
    return stability / bandPowers.length;
  }
  
  detectPeriodicity(bandPowers) {
    // Простой детектор периодичности на основе автокорреляции
    if (!this.energyHistory) {
      this.energyHistory = new Array(20).fill(0);
    }
    
    const totalEnergy = bandPowers.reduce((sum, power) => sum + power, 0);
    this.energyHistory.shift();
    this.energyHistory.push(totalEnergy);
    
    // Вычисляем автокорреляцию для поиска периодичности
    let maxCorrelation = 0;
    for (let lag = 2; lag < 10; lag++) {
      let correlation = 0;
      for (let i = lag; i < this.energyHistory.length; i++) {
        correlation += this.energyHistory[i] * this.energyHistory[i - lag];
      }
      maxCorrelation = Math.max(maxCorrelation, correlation);
    }
    
    const normalizedCorrelation = maxCorrelation / (this.energyHistory.length * totalEnergy + 0.00001);
    return Math.min(normalizedCorrelation, 1.0);
  }
  
  updateNoiseModels(bandPowers, isVoiceActive) {
    for (let i = 0; i < this.bands; i++) {
      const power = bandPowers[i];
      const adaptRate = this.adaptationRates[i];
      
      if (isVoiceActive) {
        // Обновляем модель речи
        this.speechPowers[i] = (1 - adaptRate) * this.speechPowers[i] + adaptRate * power;
      } else {
        // Обновляем модель шума (более быстрая адаптация)
        this.noisePowers[i] = (1 - adaptRate * 2) * this.noisePowers[i] + adaptRate * 2 * power;
      }
    }
  }
  
  calculateSuppressionFactors(bandPowers) {
    const suppressionFactors = new Float32Array(this.bands);
    const sensitivity = this.sensitivity / 100;
    
    // Вычисляем общую энергию сигнала
    const totalPower = bandPowers.reduce((sum, power) => sum + power, 0);
    
    for (let i = 0; i < this.bands; i++) {
      const signalPower = bandPowers[i];
      const noisePower = this.noisePowers[i];
      const speechPower = this.speechPowers[i];
      
      // Улучшенная SNR оценка с учетом соседних полос
      const neighborWeight = 0.1;
      const prevBand = i > 0 ? bandPowers[i-1] : signalPower;
      const nextBand = i < this.bands-1 ? bandPowers[i+1] : signalPower;
      const weightedSignal = signalPower + neighborWeight * (prevBand + nextBand);
      
      const snr = weightedSignal / (noisePower + 0.00001);
      const snrDb = 10 * Math.log10(snr);
      
      // Улучшенная вероятность речи
      const speechProb = speechPower / (speechPower + noisePower + 0.00001);
      const speechConfidence = Math.min(1.0, speechProb * 2);
      
      // Частотно-зависимое подавление (высокие частоты более агрессивно)
      const freqFactor = (i + 1) / this.bands;
      const freqWeight = 0.5 + 0.5 * freqFactor; // 0.5 для низких, 1.0 для высоких частот
      
      // Многоступенчатое подавление
      let suppressionFactor = 1.0;
      
      // 1. Wiener фильтр (базовое подавление)
      const wienerGain = snr / (snr + 1);
      suppressionFactor *= wienerGain;
      
      // 2. Спектральное вычитание для низких SNR
      if (snrDb < 10) {
        const spectralSubtraction = Math.max(0.1, 1 - (noisePower / (signalPower + 0.00001)) * freqWeight);
        suppressionFactor *= spectralSubtraction;
      }
      
      // 3. Адаптивное подавление на основе чувствительности
      const aggressiveness = sensitivity * freqWeight;
      if (aggressiveness > 0.3) {
        const adaptiveFactor = Math.pow(suppressionFactor, 1 + aggressiveness);
        suppressionFactor = adaptiveFactor;
      }
      
      // 4. Подавление на основе вероятности речи
      if (speechConfidence < 0.5) {
        const speechSuppression = 0.1 + 0.9 * speechConfidence;
        suppressionFactor *= speechSuppression;
      }
      
      // 5. Noise Gate для очень слабых сигналов
      if (signalPower < this.noiseGateThreshold) {
        suppressionFactor *= this.noiseGateRatio;
      }
      
      // 6. Защита от переподавления речи
      if (speechConfidence > 0.8 && snrDb > 15) {
        suppressionFactor = Math.max(suppressionFactor, 0.7);
      }
      
      // Ограничиваем диапазон (более агрессивный минимум)
      suppressionFactors[i] = Math.max(0.005, Math.min(1.0, suppressionFactor));
    }
    
    // Улучшенное временное сглаживание с адаптивной скоростью
    for (let i = 0; i < this.bands; i++) {
      const currentFactor = suppressionFactors[i];
      const prevFactor = this.smoothingFactors[i];
      
      // Адаптивная скорость сглаживания
      let adaptiveRate = this.smoothingRate;
      if (currentFactor < prevFactor) {
        // Быстрее реагируем на подавление шума
        adaptiveRate *= 1.5;
      } else {
        // Медленнее восстанавливаем при речи
        adaptiveRate *= 0.7;
      }
      
      this.smoothingFactors[i] = (1 - adaptiveRate) * prevFactor + adaptiveRate * currentFactor;
      suppressionFactors[i] = this.smoothingFactors[i];
    }
    
    // Обновляем статистику качества
    const avgSuppression = suppressionFactors.reduce((sum, factor) => sum + factor, 0) / this.bands;
    this.totalNoiseSuppressed += (1 - avgSuppression);
    this.qualityScore = Math.max(0, 100 - (this.totalNoiseSuppressed / this.processedFrames) * 1000);
    
    return suppressionFactors;
  }
  
  applySpectralSubtraction(inputChannel, outputChannel, suppressionFactors) {
    // Применяем подавление для каждой полосы
    for (let i = 0; i < inputChannel.length; i++) {
      let sample = inputChannel[i];
      
      // Простое применение коэффициентов (можно улучшить FFT)
      let processedSample = 0;
      let totalWeight = 0;
      
      for (let band = 0; band < this.bands; band++) {
        const bandSample = this.bandBuffers[band][i];
        const weight = suppressionFactors[band];
        processedSample += bandSample * weight;
        totalWeight += weight;
      }
      
      if (totalWeight > 0) {
        sample = processedSample / totalWeight;
      } else {
        sample *= 0.1; // Сильное подавление если все веса малы
      }
      
      outputChannel[i] = sample;
    }
  }
  
  postProcess(outputChannel) {
    // Пост-обработка: устранение артефактов
    for (let i = 1; i < outputChannel.length - 1; i++) {
      const current = outputChannel[i];
      const prev = outputChannel[i - 1];
      const next = outputChannel[i + 1];
      
      // Устранение резких скачков (импульсов)
      if (Math.abs(current) > Math.abs(prev) * 3 && Math.abs(current) > Math.abs(next) * 3) {
        outputChannel[i] = (prev + next) / 2;
      }
      
      // Сглаживание
      if (i % 4 === 0) {
        outputChannel[i] = 0.7 * current + 0.15 * prev + 0.15 * next;
      }
    }
    
    // Нормализация
    let maxSample = 0;
    for (let i = 0; i < outputChannel.length; i++) {
      maxSample = Math.max(maxSample, Math.abs(outputChannel[i]));
    }
    
    if (maxSample > 0.95) {
      const normFactor = 0.95 / maxSample;
      for (let i = 0; i < outputChannel.length; i++) {
        outputChannel[i] *= normFactor;
      }
    }
  }
  
  static get parameterDescriptors() {
    return [];
  }
}

// Регистрируем наш продвинутый процессор
registerProcessor('advanced-noise-processor', AdvancedNoiseProcessor); 