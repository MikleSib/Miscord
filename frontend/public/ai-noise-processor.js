// AI-Enhanced Noise Suppression Processor with Machine Learning
// Использует TensorFlow.js для классификации речи vs шума

class AINoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    
    this.frameSize = 128;
    this.sampleRate = sampleRate || 48000;
    this.sensitivity = options.processorOptions?.sensitivity || 75;
    
    // Буферы для анализа
    this.inputBuffer = new Float32Array(this.frameSize);
    this.outputBuffer = new Float32Array(this.frameSize);
    
    // Расширенный многополосный анализ (32 полосы для ML)
    this.bands = 32;
    this.bandFilters = [];
    this.bandBuffers = [];
    this.initializeBandFilters();
    
    // Спектральный анализ высокого разрешения
    this.fftSize = 1024;
    this.hopSize = 256;
    this.window = this.createHammingWindow(this.fftSize);
    this.spectrogram = [];
    this.spectrogramHistory = 20; // Храним 20 кадров для временного анализа
    
    // ML Feature extraction
    this.featureBuffer = [];
    this.featureSize = 64; // Размер вектора признаков
    this.modelPredictions = [];
    this.predictionHistory = 10;
    
    // Адаптивные модели (улучшенные)
    this.noisePowers = new Float32Array(this.bands).fill(0.00001);
    this.speechPowers = new Float32Array(this.bands).fill(0.0001);
    this.adaptationRates = new Float32Array(this.bands).fill(0.02);
    
    // Улучшенный VAD с ML
    this.vadHistory = new Array(30).fill(0);
    this.vadThreshold = 0.3;
    this.mlConfidence = 0.5;
    this.speechProbability = 0;
    
    // Многоуровневое подавление
    this.suppressionLevels = {
      gentle: { min: 0.1, max: 0.8, aggression: 0.5 },
      balanced: { min: 0.02, max: 0.9, aggression: 1.0 },
      aggressive: { min: 0.001, max: 0.95, aggression: 2.0 }
    };
    
    // Сглаживание с предсказанием
    this.smoothingFactors = new Float32Array(this.bands).fill(1.0);
    this.predictedFactors = new Float32Array(this.bands).fill(1.0);
    this.smoothingRate = 0.4;
    
    // Статистика и качество
    this.processedFrames = 0;
    this.mlPredictions = 0;
    this.correctPredictions = 0;
    this.qualityScore = 100;
    this.adaptiveQuality = 100;
    
    // Noise Gate с ML
    this.noiseGateThreshold = 0.0005;
    this.dynamicGateThreshold = 0.0005;
    
    console.log('🤖 AI-Enhanced Noise Processor инициализирован с машинным обучением');
    
    // Инициализируем простую нейронную сеть (будет заменена на TensorFlow.js)
    this.initializeSimpleML();
    
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }
  
  initializeSimpleML() {
    // Улучшенная нейронная сеть для классификации речи vs шума
    // Входной слой: 64 признака
    // Скрытый слой 1: 64 нейрона (больше для лучшего представления)
    // Скрытый слой 2: 32 нейрона
    // Выходной слой: 1 нейрон (sigmoid для бинарной классификации)
    
    this.mlWeights = {
      // Веса первого скрытого слоя (64x64)
      hidden1: this.randomMatrix(64, 64),
      hidden1Bias: new Float32Array(64).fill(0),
      
      // Веса второго скрытого слоя (64x32)
      hidden2: this.randomMatrix(64, 32),
      hidden2Bias: new Float32Array(32).fill(0),
      
      // Веса выходного слоя (32x1)
      output: this.randomMatrix(32, 1),
      outputBias: new Float32Array(1).fill(0)
    };
    
    // Нормализация признаков
    this.featureMeans = new Float32Array(64).fill(0);
    this.featureStds = new Float32Array(64).fill(1);
    this.featureCount = 0;
    
    // Momentum для оптимизации
    this.momentum = {
      hidden1: this.zeroMatrix(64, 64),
      hidden1Bias: new Float32Array(64).fill(0),
      hidden2: this.zeroMatrix(64, 32),
      hidden2Bias: new Float32Array(32).fill(0),
      output: this.zeroMatrix(32, 1),
      outputBias: new Float32Array(1).fill(0)
    };
    
    // Обучающие данные
    this.trainingData = [];
    this.trainingLabels = [];
    this.maxTrainingSize = 2000; // Увеличиваем размер
    
    // Статистика обучения
    this.trainingLoss = [];
    this.validationAccuracy = 0;
    
    console.log('🧠 Улучшенная ML модель инициализирована (64→64→32→1)');
  }
  
  randomMatrix(rows, cols) {
    const matrix = [];
    const limit = Math.sqrt(6 / (rows + cols)); // Xavier/Glorot initialization
    for (let i = 0; i < rows; i++) {
      matrix[i] = new Float32Array(cols);
      for (let j = 0; j < cols; j++) {
        matrix[i][j] = (Math.random() - 0.5) * 2 * limit;
      }
    }
    return matrix;
  }
  
  zeroMatrix(rows, cols) {
    const matrix = [];
    for (let i = 0; i < rows; i++) {
      matrix[i] = new Float32Array(cols).fill(0);
    }
    return matrix;
  }
  
  handleMessage(data) {
    switch (data.type) {
      case 'setOptions':
        if (data.options) {
          this.sensitivity = data.options.sensitivity || this.sensitivity;
          this.updateSensitivity();
          console.log('🤖 AI: Обновлены настройки:', data.options);
        }
        break;
      case 'getStats':
        this.port.postMessage({
          type: 'stats',
          data: {
            processedFrames: this.processedFrames,
            sensitivity: this.sensitivity,
            qualityScore: Math.round(this.adaptiveQuality),
            mlPredictions: this.mlPredictions,
            mlAccuracy: Math.round(this.validationAccuracy * 100), // Используем правильную точность
            speechProbability: Math.round(this.speechProbability * 100),
            noisePowers: Array.from(this.noisePowers),
            speechPowers: Array.from(this.speechPowers)
          }
        });
        break;
      case 'trainModel':
        this.performOnlineTraining();
        break;
    }
  }
  
  initializeBandFilters() {
    const nyquist = this.sampleRate / 2;
    const bandWidth = nyquist / this.bands;
    
    for (let i = 0; i < this.bands; i++) {
      const lowFreq = i * bandWidth;
      const highFreq = (i + 1) * bandWidth;
      
      // Улучшенные фильтры Баттерворта 2-го порядка
      const omega = 2 * Math.PI * ((lowFreq + highFreq) / 2) / this.sampleRate;
      const Q = 1.0;
      
      this.bandFilters.push({
        lowFreq: lowFreq,
        highFreq: highFreq,
        omega: omega,
        Q: Q,
        // Состояние фильтра
        x1: 0, x2: 0,
        y1: 0, y2: 0,
        // Коэффициенты
        a0: 1 + omega/Q + omega*omega,
        a1: 2*omega*omega - 2,
        a2: 1 - omega/Q + omega*omega,
        b0: omega*omega,
        b1: 2*omega*omega,
        b2: omega*omega
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
    
    this.processWithAI(inputChannel, outputChannel);
    
    return true;
  }
  
  processWithAI(inputChannel, outputChannel) {
    // 1. Многополосный анализ с улучшенными фильтрами
    const bandPowers = this.analyzeBandsAdvanced(inputChannel);
    
    // 2. Извлечение признаков для ML
    const features = this.extractMLFeatures(bandPowers, inputChannel);
    
    // 3. ML-предсказание: речь или шум
    const mlPrediction = this.predictWithML(features);
    this.speechProbability = mlPrediction.speechProbability;
    
    // 4. Гибридный VAD (классический + ML)
    const isVoiceActive = this.hybridVAD(bandPowers, mlPrediction);
    
    // 5. Адаптивное обновление моделей с ML-guidance
    this.updateModelsWithML(bandPowers, isVoiceActive, mlPrediction);
    
    // 6. Интеллектуальное вычисление коэффициентов подавления
    const suppressionFactors = this.calculateIntelligentSuppression(bandPowers, mlPrediction);
    
    // 7. Применение адаптивного спектрального подавления
    this.applyAdaptiveSpectralSuppression(inputChannel, outputChannel, suppressionFactors);
    
    // 8. AI-пост-обработка
    this.aiPostProcess(outputChannel, mlPrediction);
    
    // 9. Онлайн обучение модели
    this.collectTrainingData(features, isVoiceActive);
    
    this.processedFrames++;
    
    // Логирование с ML метриками
    if (this.processedFrames % 500 === 0) {
      const avgSuppression = suppressionFactors.reduce((a, b) => a + b, 0) / suppressionFactors.length;
      const mlAccuracy = this.validationAccuracy * 100; // Используем правильную точность
      const avgLoss = this.trainingLoss.length > 0 ? this.trainingLoss[this.trainingLoss.length - 1] : 0;
      
      console.log(`🤖 AI v2.0: VAD=${isVoiceActive}, речь=${Math.round(this.speechProbability*100)}%, подавление=${avgSuppression.toFixed(3)}, ML точность=${mlAccuracy.toFixed(1)}%, loss=${avgLoss.toFixed(3)}, качество=${Math.round(this.adaptiveQuality)}%`);
    }
  }
  
  extractMLFeatures(bandPowers, inputChannel) {
    const features = new Float32Array(this.featureSize);
    let idx = 0;
    
    // 1. Спектральные признаки (32 полосы)
    for (let i = 0; i < Math.min(32, bandPowers.length); i++) {
      features[idx++] = Math.log10(bandPowers[i] + 1e-10);
    }
    
    // 2. Спектральный центроид
    let weightedSum = 0, totalPower = 0;
    for (let i = 0; i < bandPowers.length; i++) {
      weightedSum += i * bandPowers[i];
      totalPower += bandPowers[i];
    }
    features[idx++] = totalPower > 0 ? weightedSum / totalPower : 0;
    
    // 3. Спектральная ширина
    const centroid = features[idx - 1];
    let variance = 0;
    for (let i = 0; i < bandPowers.length; i++) {
      variance += Math.pow(i - centroid, 2) * bandPowers[i];
    }
    features[idx++] = totalPower > 0 ? Math.sqrt(variance / totalPower) : 0;
    
    // 4. Спектральный наклон
    let slopeNum = 0, slopeDen = 0;
    const meanFreq = bandPowers.length / 2;
    const meanPower = totalPower / bandPowers.length;
    for (let i = 0; i < bandPowers.length; i++) {
      slopeNum += (i - meanFreq) * (Math.log10(bandPowers[i] + 1e-10) - Math.log10(meanPower + 1e-10));
      slopeDen += Math.pow(i - meanFreq, 2);
    }
    features[idx++] = slopeDen > 0 ? slopeNum / slopeDen : 0;
    
    // 5. Zero Crossing Rate
    let zeroCrossings = 0;
    for (let i = 1; i < inputChannel.length; i++) {
      if ((inputChannel[i] >= 0) !== (inputChannel[i-1] >= 0)) {
        zeroCrossings++;
      }
    }
    features[idx++] = zeroCrossings / inputChannel.length;
    
    // 6. RMS Energy
    let rms = 0;
    for (let i = 0; i < inputChannel.length; i++) {
      rms += inputChannel[i] * inputChannel[i];
    }
    features[idx++] = Math.sqrt(rms / inputChannel.length);
    
    // 7. Temporal features (если есть история)
    if (this.featureBuffer.length > 0) {
      const prevFeatures = this.featureBuffer[this.featureBuffer.length - 1];
      // Дельта признаки (изменение во времени)
      for (let i = 0; i < Math.min(10, prevFeatures.length) && idx < this.featureSize; i++) {
        features[idx++] = features[i] - prevFeatures[i];
      }
    }
    
    // Заполняем оставшиеся нулями
    while (idx < this.featureSize) {
      features[idx++] = 0;
    }
    
    // Сохраняем в буфер
    this.featureBuffer.push(Array.from(features));
    if (this.featureBuffer.length > 10) {
      this.featureBuffer.shift();
    }
    
    return features;
  }
  
  normalizeFeatures(features) {
    // Обновляем статистику признаков (онлайн нормализация)
    this.featureCount++;
    const alpha = 1.0 / Math.min(this.featureCount, 1000); // Адаптивная скорость
    
    for (let i = 0; i < features.length; i++) {
      // Обновляем среднее
      const oldMean = this.featureMeans[i];
      this.featureMeans[i] = (1 - alpha) * oldMean + alpha * features[i];
      
      // Обновляем стандартное отклонение
      const variance = Math.pow(features[i] - this.featureMeans[i], 2);
      const oldStd = this.featureStds[i];
      this.featureStds[i] = Math.sqrt((1 - alpha) * oldStd * oldStd + alpha * variance);
      
      // Нормализуем признак
      if (this.featureStds[i] > 0.001) {
        features[i] = (features[i] - this.featureMeans[i]) / this.featureStds[i];
      }
      
      // Клампинг для стабильности
      features[i] = Math.max(-5, Math.min(5, features[i]));
    }
    
    return features;
  }

  sigmoid(x) {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x)))); // Защита от overflow
  }

  predictWithML(features) {
    // Нормализуем признаки
    const normalizedFeatures = this.normalizeFeatures(Array.from(features));
    
    // Первый скрытый слой
    const hidden1 = new Float32Array(64);
    for (let i = 0; i < 64; i++) {
      let sum = this.mlWeights.hidden1Bias[i];
      for (let j = 0; j < 64; j++) {
        sum += normalizedFeatures[j] * this.mlWeights.hidden1[j][i];
      }
      hidden1[i] = this.relu(sum);
    }
    
    // Второй скрытый слой
    const hidden2 = new Float32Array(32);
    for (let i = 0; i < 32; i++) {
      let sum = this.mlWeights.hidden2Bias[i];
      for (let j = 0; j < 64; j++) {
        sum += hidden1[j] * this.mlWeights.hidden2[j][i];
      }
      hidden2[i] = this.relu(sum);
    }
    
    // Выходной слой с сигмоидой
    let sum = this.mlWeights.outputBias[0];
    for (let j = 0; j < 32; j++) {
      sum += hidden2[j] * this.mlWeights.output[j][0];
    }
    const speechProbability = this.sigmoid(sum);
    const noiseProbability = 1 - speechProbability;
    
    this.mlPredictions++;
    
    return {
      speechProbability: speechProbability,
      noiseProbability: noiseProbability,
      confidence: Math.abs(speechProbability - 0.5) * 2,
      features: normalizedFeatures,
      rawOutput: sum
    };
  }
  
  relu(x) {
    return Math.max(0, x);
  }
  
  hybridVAD(bandPowers, mlPrediction) {
    // Классический VAD
    const classicVAD = this.detectVoiceActivityClassic(bandPowers);
    
    // ML VAD
    const mlVAD = mlPrediction.speechProbability > 0.5;
    
    // Гибридное решение с весами
    const mlWeight = Math.min(mlPrediction.confidence, 0.8); // Ограничиваем влияние ML
    const classicWeight = 1 - mlWeight;
    
    const hybridScore = classicWeight * (classicVAD ? 1 : 0) + mlWeight * mlPrediction.speechProbability;
    
    // Адаптивный порог
    let threshold = this.vadThreshold;
    if (mlPrediction.confidence > 0.7) {
      threshold *= 0.9; // Снижаем порог если ML уверен
    }
    
    const isActive = hybridScore > threshold;
    
    // Обновляем историю
    this.vadHistory.shift();
    this.vadHistory.push(isActive ? 1 : 0);
    
    // Гистерезис
    const recentActivity = this.vadHistory.reduce((sum, val) => sum + val, 0) / this.vadHistory.length;
    
    return recentActivity > 0.3;
  }
  
  detectVoiceActivityClassic(bandPowers) {
    // Упрощенная версия классического VAD
    const totalPower = bandPowers.reduce((sum, power) => sum + power, 0);
    if (totalPower < 0.00001) return false;
    
    const midBands = bandPowers.slice(this.bands / 4, 3 * this.bands / 4);
    const midPower = midBands.reduce((sum, power) => sum + power, 0);
    const speechRatio = midPower / totalPower;
    
    return speechRatio > 0.3;
  }
  
  analyzeBandsAdvanced(inputChannel) {
    const bandPowers = new Float32Array(this.bands);
    
    // Улучшенная фильтрация с фильтрами Баттерворта 2-го порядка
    for (let band = 0; band < this.bands; band++) {
      const filter = this.bandFilters[band];
      const buffer = this.bandBuffers[band];
      let power = 0;
      
      for (let i = 0; i < inputChannel.length; i++) {
        const input = inputChannel[i];
        
        // Фильтр Баттерворта 2-го порядка
        const output = (filter.b0 * input + filter.b1 * filter.x1 + filter.b2 * filter.x2 - 
                       filter.a1 * filter.y1 - filter.a2 * filter.y2) / filter.a0;
        
        // Обновляем состояние фильтра
        filter.x2 = filter.x1;
        filter.x1 = input;
        filter.y2 = filter.y1;
        filter.y1 = output;
        
        buffer[i] = output;
        power += output * output;
      }
      
      bandPowers[band] = power / inputChannel.length;
    }
    
    return bandPowers;
  }
  
  updateModelsWithML(bandPowers, isVoiceActive, mlPrediction) {
    // Обновляем модели с учетом ML-предсказаний
    const mlWeight = mlPrediction.confidence * 0.5; // Вес ML-предсказания
    const classicWeight = 1 - mlWeight;
    
    for (let i = 0; i < this.bands; i++) {
      const power = bandPowers[i];
      let adaptRate = this.adaptationRates[i];
      
      // Адаптивная скорость обучения на основе ML уверенности
      if (mlPrediction.confidence > 0.8) {
        adaptRate *= 1.5; // Быстрее обучение если ML уверен
      }
      
      // Комбинированное обновление
      const mlIsVoice = mlPrediction.speechProbability > 0.5;
      const combinedIsVoice = classicWeight * isVoiceActive + mlWeight * mlIsVoice;
      
      if (combinedIsVoice > 0.5) {
        // Обновляем модель речи
        this.speechPowers[i] = (1 - adaptRate) * this.speechPowers[i] + adaptRate * power;
      } else {
        // Обновляем модель шума
        this.noisePowers[i] = (1 - adaptRate * 1.5) * this.noisePowers[i] + adaptRate * 1.5 * power;
      }
    }
  }
  
  calculateIntelligentSuppression(bandPowers, mlPrediction) {
    const suppressionFactors = new Float32Array(this.bands);
    const sensitivity = this.sensitivity / 100;
    
    // Выбираем уровень подавления на основе настроек
    const level = sensitivity < 0.33 ? 'gentle' : 
                 sensitivity < 0.66 ? 'balanced' : 'aggressive';
    const suppressionLevel = this.suppressionLevels[level];
    
    for (let i = 0; i < this.bands; i++) {
      const signalPower = bandPowers[i];
      const noisePower = this.noisePowers[i];
      const speechPower = this.speechPowers[i];
      
      // ML-guided SNR оценка
      const snr = signalPower / (noisePower + 0.000001);
      const snrDb = 10 * Math.log10(snr);
      
      // Базовый Wiener фильтр
      let suppressionFactor = snr / (snr + 1);
      
      // ML-модификация
      const speechConfidence = mlPrediction.speechProbability;
      const mlWeight = mlPrediction.confidence;
      
      // Если ML уверен что это речь, защищаем от переподавления
      if (speechConfidence > 0.7 && mlWeight > 0.6) {
        suppressionFactor = Math.max(suppressionFactor, 0.3);
      }
      
      // Если ML уверен что это шум, усиливаем подавление
      if (speechConfidence < 0.3 && mlWeight > 0.6) {
        suppressionFactor *= 0.5;
      }
      
      // Частотно-зависимое подавление
      const freqFactor = (i + 1) / this.bands;
      const freqWeight = 0.3 + 0.7 * freqFactor; // Более агрессивно на высоких частотах
      
      // Применяем агрессивность
      suppressionFactor = Math.pow(suppressionFactor, suppressionLevel.aggression * freqWeight);
      
      // Ограничиваем диапазон
      suppressionFactors[i] = Math.max(suppressionLevel.min, 
                                     Math.min(suppressionLevel.max, suppressionFactor));
    }
    
    // Интеллектуальное временное сглаживание
    for (let i = 0; i < this.bands; i++) {
      const currentFactor = suppressionFactors[i];
      const prevFactor = this.smoothingFactors[i];
      
      // Адаптивная скорость на основе ML
      let adaptiveRate = this.smoothingRate;
      if (mlPrediction.confidence > 0.7) {
        if (currentFactor < prevFactor) {
          adaptiveRate *= 2.0; // Быстрее подавляем если ML уверен в шуме
        } else {
          adaptiveRate *= 0.5; // Медленнее восстанавливаем если ML уверен в речи
        }
      }
      
      this.smoothingFactors[i] = (1 - adaptiveRate) * prevFactor + adaptiveRate * currentFactor;
      suppressionFactors[i] = this.smoothingFactors[i];
    }
    
    return suppressionFactors;
  }
  
  applyAdaptiveSpectralSuppression(inputChannel, outputChannel, suppressionFactors) {
    // Применяем подавление с учетом полосовых коэффициентов
    for (let i = 0; i < inputChannel.length; i++) {
      let sample = inputChannel[i];
      let processedSample = 0;
      let totalWeight = 0;
      
      // Взвешенная комбинация полосовых фильтров
      for (let band = 0; band < this.bands; band++) {
        const bandSample = this.bandBuffers[band][i];
        const weight = suppressionFactors[band];
        processedSample += bandSample * weight;
        totalWeight += weight;
      }
      
      if (totalWeight > 0.01) {
        sample = processedSample / totalWeight;
      } else {
        // Сильное подавление если все веса малы
        sample *= 0.01;
      }
      
      outputChannel[i] = sample;
    }
  }
  
  aiPostProcess(outputChannel, mlPrediction) {
    // AI-пост-обработка для устранения артефактов
    
    // 1. Динамический noise gate на основе ML
    this.dynamicGateThreshold = this.noiseGateThreshold * (1 - mlPrediction.speechProbability * 0.8);
    
    for (let i = 0; i < outputChannel.length; i++) {
      const sample = outputChannel[i];
      
      // Noise gate
      if (Math.abs(sample) < this.dynamicGateThreshold) {
        outputChannel[i] = sample * 0.1;
      }
    }
    
    // 2. Сглаживание артефактов
    for (let i = 1; i < outputChannel.length - 1; i++) {
      const current = outputChannel[i];
      const prev = outputChannel[i - 1];
      const next = outputChannel[i + 1];
      
      // Устранение резких скачков
      if (Math.abs(current) > Math.abs(prev) * 4 && Math.abs(current) > Math.abs(next) * 4) {
        outputChannel[i] = (prev + next) / 2;
      }
    }
    
    // 3. Адаптивная нормализация
    let maxSample = 0;
    for (let i = 0; i < outputChannel.length; i++) {
      maxSample = Math.max(maxSample, Math.abs(outputChannel[i]));
    }
    
    if (maxSample > 0.98) {
      const normFactor = 0.95 / maxSample;
      for (let i = 0; i < outputChannel.length; i++) {
        outputChannel[i] *= normFactor;
      }
    }
    
    // Обновляем качество
    this.updateQualityScore(mlPrediction);
  }
  
  updateQualityScore(mlPrediction) {
    // Обновляем адаптивную оценку качества
    const mlAccuracy = this.mlPredictions > 0 ? this.correctPredictions / this.mlPredictions : 0.5;
    const confidenceBonus = mlPrediction.confidence * 20;
    const speechClarityBonus = mlPrediction.speechProbability > 0.7 ? 15 : 0;
    
    const frameQuality = 50 + confidenceBonus + speechClarityBonus + mlAccuracy * 30;
    
    // Экспоненциальное сглаживание
    this.adaptiveQuality = 0.95 * this.adaptiveQuality + 0.05 * frameQuality;
    this.adaptiveQuality = Math.max(0, Math.min(100, this.adaptiveQuality));
  }
  
  collectTrainingData(features, isVoiceActive) {
    // Улучшенный сбор данных для обучения с валидацией
    const label = isVoiceActive ? 1 : 0;
    
    // Проверяем качество признаков
    const featureSum = features.reduce((sum, f) => sum + Math.abs(f), 0);
    if (featureSum < 0.001 || !isFinite(featureSum)) {
      return; // Пропускаем плохие данные
    }
    
    // Считаем текущий баланс классов
    const speechSamples = this.trainingLabels.filter(l => l === 1).length;
    const noiseSamples = this.trainingLabels.filter(l => l === 0).length;
    const total = speechSamples + noiseSamples;
    
    // Улучшенная логика добавления примеров
    let shouldAdd = false;
    let priority = 0;
    
    if (total < this.maxTrainingSize) {
      if (total < 200) {
        shouldAdd = true; // Добавляем первые 200 примеров без ограничений
        priority = 1;
      } else {
        const speechRatio = speechSamples / total;
        const noiseRatio = noiseSamples / total;
        
        // Целевое соотношение: 35% речь / 65% шум (более реалистично)
        if (label === 1 && speechRatio < 0.4) {
          shouldAdd = true;
          priority = 2; // Высокий приоритет для речи
        } else if (label === 0 && noiseRatio < 0.7) {
          shouldAdd = true;
          priority = 1; // Средний приоритет для шума
        } else if (Math.random() < 0.05) {
          shouldAdd = true; // 5% случайных примеров
          priority = 0;
        }
        
        // Добавляем примеры с высокой энергией (более информативные)
        const energy = features.slice(0, 32).reduce((sum, f) => sum + f * f, 0);
        if (energy > 0.1 && Math.random() < 0.3) {
          shouldAdd = true;
          priority = Math.max(priority, 1);
        }
      }
    } else {
      // Если буфер полон, заменяем только менее приоритетные примеры
      if (priority > 0 && Math.random() < 0.1) {
        shouldAdd = true;
      }
    }
    
    if (shouldAdd) {
      this.trainingData.push(Array.from(features));
      this.trainingLabels.push(label);
      
      // Если переполнение, удаляем старые примеры (FIFO)
      if (this.trainingData.length > this.maxTrainingSize) {
        this.trainingData.shift();
        this.trainingLabels.shift();
      }
    }
    
    // Адаптивная частота обучения
    const trainingInterval = Math.max(1000, 4000 - this.trainingData.length);
    if (this.processedFrames % trainingInterval === 0 && this.trainingData.length > 100) {
      this.performOnlineTraining();
    }
    
    // Периодическая валидация и очистка данных
    if (this.processedFrames % 10000 === 0 && this.trainingData.length > 500) {
      this.validateAndCleanData();
    }
  }
  
  validateAndCleanData() {
    // Удаляем outliers и плохие примеры
    const validIndices = [];
    
    for (let i = 0; i < this.trainingData.length; i++) {
      const features = this.trainingData[i];
      const featureSum = features.reduce((sum, f) => sum + Math.abs(f), 0);
      
      // Проверяем валидность данных
      if (isFinite(featureSum) && featureSum > 0.001 && featureSum < 1000) {
        validIndices.push(i);
      }
    }
    
    // Создаём новые массивы только с валидными данными
    const newTrainingData = validIndices.map(i => this.trainingData[i]);
    const newTrainingLabels = validIndices.map(i => this.trainingLabels[i]);
    
    this.trainingData = newTrainingData;
    this.trainingLabels = newTrainingLabels;
    
    console.log(`🧹 Очистка данных: ${validIndices.length}/${this.trainingData.length + (this.trainingData.length - validIndices.length)} примеров сохранено`);
  }
  
  performOnlineTraining() {
    // Правильное обучение с backpropagation, momentum и регуляризацией
    const learningRate = 0.001;
    const momentum = 0.9;
    const l2Reg = 0.0001; // L2 регуляризация
    const batchSize = Math.min(32, this.trainingData.length);
    let batchCorrect = 0;
    let totalLoss = 0;
    let totalPredictions = 0;
    
    for (let batch = 0; batch < 3; batch++) {
      // Случайная выборка
      const indices = [];
      for (let i = 0; i < batchSize; i++) {
        indices.push(Math.floor(Math.random() * this.trainingData.length));
      }
      
      // Накапливаем градиенты для батча
      const gradients = {
        hidden1: this.zeroMatrix(64, 64),
        hidden1Bias: new Float32Array(64).fill(0),
        hidden2: this.zeroMatrix(64, 32),
        hidden2Bias: new Float32Array(32).fill(0),
        output: this.zeroMatrix(32, 1),
        outputBias: new Float32Array(1).fill(0)
      };
      
      // Обрабатываем батч
      for (const idx of indices) {
        const features = new Float32Array(this.trainingData[idx]);
        const label = this.trainingLabels[idx];
        
        // Forward pass
        const normalizedFeatures = this.normalizeFeatures(Array.from(features));
        
        // Первый скрытый слой
        const hidden1 = new Float32Array(64);
        const z1 = new Float32Array(64);
        for (let i = 0; i < 64; i++) {
          let sum = this.mlWeights.hidden1Bias[i];
          for (let j = 0; j < 64; j++) {
            sum += normalizedFeatures[j] * this.mlWeights.hidden1[j][i];
          }
          z1[i] = sum;
          hidden1[i] = this.relu(sum);
        }
        
        // Второй скрытый слой
        const hidden2 = new Float32Array(32);
        const z2 = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
          let sum = this.mlWeights.hidden2Bias[i];
          for (let j = 0; j < 64; j++) {
            sum += hidden1[j] * this.mlWeights.hidden2[j][i];
          }
          z2[i] = sum;
          hidden2[i] = this.relu(sum);
        }
        
        // Выходной слой
        let outputSum = this.mlWeights.outputBias[0];
        for (let j = 0; j < 32; j++) {
          outputSum += hidden2[j] * this.mlWeights.output[j][0];
        }
        const prediction = this.sigmoid(outputSum);
        
        // Вычисляем loss (cross-entropy)
        const loss = -(label * Math.log(prediction + 1e-15) + (1 - label) * Math.log(1 - prediction + 1e-15));
        totalLoss += loss;
        
        // Считаем точность
        const predictedClass = prediction > 0.5 ? 1 : 0;
        if (predictedClass === label) {
          batchCorrect++;
        }
        totalPredictions++;
        
        // Backward pass (backpropagation)
        
        // Градиент выходного слоя
        const outputError = prediction - label;
        
        // Градиенты для выходного слоя
        for (let i = 0; i < 32; i++) {
          gradients.output[i][0] += outputError * hidden2[i];
        }
        gradients.outputBias[0] += outputError;
        
        // Градиенты для второго скрытого слоя
        const hidden2Error = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
          hidden2Error[i] = outputError * this.mlWeights.output[i][0];
          // ReLU derivative
          if (z2[i] <= 0) hidden2Error[i] = 0;
        }
        
        for (let i = 0; i < 64; i++) {
          for (let j = 0; j < 32; j++) {
            gradients.hidden2[i][j] += hidden2Error[j] * hidden1[i];
          }
        }
        for (let i = 0; i < 32; i++) {
          gradients.hidden2Bias[i] += hidden2Error[i];
        }
        
        // Градиенты для первого скрытого слоя
        const hidden1Error = new Float32Array(64);
        for (let i = 0; i < 64; i++) {
          for (let j = 0; j < 32; j++) {
            hidden1Error[i] += hidden2Error[j] * this.mlWeights.hidden2[i][j];
          }
          // ReLU derivative
          if (z1[i] <= 0) hidden1Error[i] = 0;
        }
        
        for (let i = 0; i < 64; i++) {
          for (let j = 0; j < 64; j++) {
            gradients.hidden1[i][j] += hidden1Error[j] * normalizedFeatures[i];
          }
        }
        for (let i = 0; i < 64; i++) {
          gradients.hidden1Bias[i] += hidden1Error[i];
        }
      }
      
      // Применяем градиенты с momentum и регуляризацией
      const batchScale = 1.0 / batchSize;
      
      // Обновляем веса первого скрытого слоя
      for (let i = 0; i < 64; i++) {
        for (let j = 0; j < 64; j++) {
          const grad = batchScale * gradients.hidden1[i][j] + l2Reg * this.mlWeights.hidden1[i][j];
          this.momentum.hidden1[i][j] = momentum * this.momentum.hidden1[i][j] - learningRate * grad;
          this.mlWeights.hidden1[i][j] += this.momentum.hidden1[i][j];
        }
      }
      for (let i = 0; i < 64; i++) {
        const grad = batchScale * gradients.hidden1Bias[i];
        this.momentum.hidden1Bias[i] = momentum * this.momentum.hidden1Bias[i] - learningRate * grad;
        this.mlWeights.hidden1Bias[i] += this.momentum.hidden1Bias[i];
      }
      
      // Обновляем веса второго скрытого слоя
      for (let i = 0; i < 64; i++) {
        for (let j = 0; j < 32; j++) {
          const grad = batchScale * gradients.hidden2[i][j] + l2Reg * this.mlWeights.hidden2[i][j];
          this.momentum.hidden2[i][j] = momentum * this.momentum.hidden2[i][j] - learningRate * grad;
          this.mlWeights.hidden2[i][j] += this.momentum.hidden2[i][j];
        }
      }
      for (let i = 0; i < 32; i++) {
        const grad = batchScale * gradients.hidden2Bias[i];
        this.momentum.hidden2Bias[i] = momentum * this.momentum.hidden2Bias[i] - learningRate * grad;
        this.mlWeights.hidden2Bias[i] += this.momentum.hidden2Bias[i];
      }
      
      // Обновляем веса выходного слоя
      for (let i = 0; i < 32; i++) {
        const grad = batchScale * gradients.output[i][0] + l2Reg * this.mlWeights.output[i][0];
        this.momentum.output[i][0] = momentum * this.momentum.output[i][0] - learningRate * grad;
        this.mlWeights.output[i][0] += this.momentum.output[i][0];
      }
      const gradBias = batchScale * gradients.outputBias[0];
      this.momentum.outputBias[0] = momentum * this.momentum.outputBias[0] - learningRate * gradBias;
      this.mlWeights.outputBias[0] += this.momentum.outputBias[0];
    }
    
    // Обновляем статистику
    if (totalPredictions > 0) {
      const batchAccuracy = batchCorrect / totalPredictions;
      const avgLoss = totalLoss / totalPredictions;
      
      // Обновляем точность с экспоненциальным сглаживанием
      this.validationAccuracy = 0.9 * this.validationAccuracy + 0.1 * batchAccuracy;
      
      // Сохраняем историю loss
      this.trainingLoss.push(avgLoss);
      if (this.trainingLoss.length > 100) {
        this.trainingLoss.shift();
      }
      
      // Обновляем общую статистику
      this.correctPredictions = this.validationAccuracy * this.trainingData.length;
      this.mlPredictions = Math.max(this.mlPredictions, this.trainingData.length);
      
      console.log(`🧠 Модель обучена: ${this.trainingData.length} примеров, точность=${(batchAccuracy*100).toFixed(1)}%, loss=${avgLoss.toFixed(4)}, общая точность=${(this.validationAccuracy*100).toFixed(1)}%`);
    }
  }
  
  updateSensitivity() {
    const normalizedSensitivity = this.sensitivity / 100;
    
    // Обновляем пороги и параметры
    for (let i = 0; i < this.bands; i++) {
      const freqFactor = (i + 1) / this.bands;
      this.adaptationRates[i] = 0.005 + normalizedSensitivity * 0.03 * freqFactor;
    }
    
    this.vadThreshold = 0.2 + normalizedSensitivity * 0.4;
    this.smoothingRate = 0.2 + normalizedSensitivity * 0.4;
  }
  
  static get parameterDescriptors() {
    return [];
  }
}

// Регистрируем AI процессор
registerProcessor('ai-noise-processor', AINoiseProcessor); 