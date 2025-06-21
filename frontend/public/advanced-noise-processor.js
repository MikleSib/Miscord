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
    
    // Многополосный анализ (8 полос)
    this.bands = 8;
    this.bandFilters = [];
    this.bandBuffers = [];
    this.initializeBandFilters();
    
    // Спектральный анализ
    this.fftSize = 256;
    this.hopSize = 128;
    this.window = this.createHammingWindow(this.fftSize);
    this.prevFrame = new Float32Array(this.fftSize);
    this.overlapBuffer = new Float32Array(this.hopSize);
    
    // Адаптивные пороги для каждой полосы
    this.noisePowers = new Float32Array(this.bands).fill(0.001);
    this.speechPowers = new Float32Array(this.bands).fill(0.01);
    this.adaptationRates = new Float32Array(this.bands).fill(0.001);
    
    // Детектор голосовой активности (VAD)
    this.vadHistory = new Array(10).fill(0);
    this.vadThreshold = 0.3;
    
    // Сглаживание коэффициентов подавления
    this.smoothingFactors = new Float32Array(this.bands).fill(1.0);
    this.smoothingRate = 0.1;
    
    // Статистика
    this.processedFrames = 0;
    this.isInitialized = true;
    
    console.log('🔇 Advanced Noise Processor инициализирован');
    
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
      case 'getStats':
        this.port.postMessage({
          type: 'stats',
          data: {
            processedFrames: this.processedFrames,
            sensitivity: this.sensitivity,
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
    
    // Логирование статистики
    if (this.processedFrames % 2000 === 0) {
      const avgSuppression = suppressionFactors.reduce((a, b) => a + b, 0) / suppressionFactors.length;
      console.log(`🔇 Advanced: VAD=${isVoiceActive}, подавление=${avgSuppression.toFixed(3)}, чувствительность=${this.sensitivity}`);
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
    
    if (totalPower < 0.0001) return false;
    
    // Голос обычно имеет больше энергии в средних частотах (полосы 2-5)
    const speechBands = bandPowers.slice(2, 6);
    const speechPower = speechBands.reduce((sum, power) => sum + power, 0);
    const speechRatio = speechPower / totalPower;
    
    // Детектор основной частоты (F0) - упрощенный
    const f0Strength = this.detectF0(bandPowers);
    
    // Комбинированный детектор
    const vadScore = speechRatio * 0.7 + f0Strength * 0.3;
    
    // Сглаживание по времени
    this.vadHistory.shift();
    this.vadHistory.push(vadScore > this.vadThreshold ? 1 : 0);
    
    const recentActivity = this.vadHistory.reduce((sum, val) => sum + val, 0);
    
    return recentActivity >= 3; // Голос активен если 3+ из последних 10 фреймов
  }
  
  detectF0(bandPowers) {
    // Простой детектор основного тона
    // Ищем гармонические отношения между полосами
    let harmonicStrength = 0;
    
    for (let i = 1; i < this.bands - 1; i++) {
      const current = bandPowers[i];
      const prev = bandPowers[i - 1];
      const next = bandPowers[i + 1];
      
      // Если текущая полоса значительно сильнее соседних,
      // это может указывать на гармонику
      if (current > prev * 1.5 && current > next * 1.5) {
        harmonicStrength += current / (prev + next + 0.001);
      }
    }
    
    return Math.min(harmonicStrength / this.bands, 1.0);
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
    
    for (let i = 0; i < this.bands; i++) {
      const signalPower = bandPowers[i];
      const noisePower = this.noisePowers[i];
      const speechPower = this.speechPowers[i];
      
      // SNR оценка
      const snr = signalPower / (noisePower + 0.0001);
      
      // Вероятность речи (байесовский подход)
      const speechProb = speechPower / (speechPower + noisePower + 0.0001);
      
      // Wiener фильтр
      let wienerGain = snr / (snr + 1);
      
      // Корректировка на основе вероятности речи
      wienerGain = wienerGain * speechProb + (1 - speechProb) * 0.1;
      
      // Применяем чувствительность
      let suppressionFactor = wienerGain;
      if (sensitivity > 0.5) {
        // Более агрессивное подавление
        suppressionFactor = Math.pow(suppressionFactor, 1 + (sensitivity - 0.5));
      } else {
        // Более консервативное подавление
        suppressionFactor = Math.sqrt(suppressionFactor * (0.5 + sensitivity));
      }
      
      // Ограничиваем диапазон
      suppressionFactors[i] = Math.max(0.02, Math.min(1.0, suppressionFactor));
    }
    
    // Сглаживание во времени
    for (let i = 0; i < this.bands; i++) {
      this.smoothingFactors[i] = (1 - this.smoothingRate) * this.smoothingFactors[i] + 
                                 this.smoothingRate * suppressionFactors[i];
      suppressionFactors[i] = this.smoothingFactors[i];
    }
    
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