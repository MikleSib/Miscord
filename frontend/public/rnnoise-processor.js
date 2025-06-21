// RNNoise AudioWorklet Processor
class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    
    this.frameSize = 480; // RNNoise требует 480 сэмплов (10ms при 48kHz)
    this.sampleRate = 48000;
    this.sensitivity = options.processorOptions?.sensitivity || 70;
    
    // Буферы для накопления сэмплов
    this.inputBuffer = new Float32Array(this.frameSize);
    this.outputBuffer = new Float32Array(this.frameSize);
    this.bufferIndex = 0;
    
    // RNNoise состояние
    this.rnnoiseState = null;
    this.wasmModule = null;
    this.inputPtr = null;
    this.outputPtr = null;
    
    // Статистика
    this.processedFrames = 0;
    this.isInitialized = false;
    
    console.log('🔇 RNNoise Processor создан, чувствительность:', this.sensitivity);
    
    // Слушаем сообщения от главного потока
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    
    // Инициализируем RNNoise
    this.initializeRNNoise();
  }
  
  handleMessage(data) {
    switch (data.type) {
      case 'setSensitivity':
        this.sensitivity = data.sensitivity;
        console.log('🔇 Обновлена чувствительность RNNoise:', this.sensitivity);
        break;
      case 'getStats':
        this.port.postMessage({
          type: 'stats',
          data: {
            processedFrames: this.processedFrames,
            isInitialized: this.isInitialized,
            sensitivity: this.sensitivity,
            frameSize: this.frameSize
          }
        });
        break;
    }
  }
  
  async initializeRNNoise() {
    try {
      console.log('🔇 Инициализация RNNoise...');
      
      // Загружаем WASM модуль RNNoise
      // В реальном проекте здесь должен быть скомпилированный WASM файл
      // Для демонстрации используем заглушку
      this.wasmModule = await this.loadWasmModule();
      
      if (this.wasmModule) {
        // Создаем состояние RNNoise
        this.rnnoiseState = this.wasmModule._rnnoise_create();
        
        // Выделяем память для буферов
        this.inputPtr = this.wasmModule._malloc(this.frameSize * 4); // Float32 = 4 байта
        this.outputPtr = this.wasmModule._malloc(this.frameSize * 4);
        
        this.isInitialized = true;
        console.log('🔇 RNNoise инициализирован успешно');
        
        this.port.postMessage({
          type: 'initialized',
          success: true
        });
      }
    } catch (error) {
      console.error('🔇 Ошибка инициализации RNNoise:', error);
      this.port.postMessage({
        type: 'initialized',
        success: false,
        error: error.message
      });
    }
  }
  
  async loadWasmModule() {
    // Заглушка для загрузки WASM модуля
    // В реальном проекте здесь должна быть загрузка скомпилированного RNNoise WASM
    console.log('🔇 Загрузка WASM модуля (заглушка)...');
    
    // Возвращаем null, чтобы использовать fallback обработку
    return null;
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
    
    // Если RNNoise не инициализирован, используем простую обработку
    if (!this.isInitialized || !this.wasmModule) {
      this.processWithSimpleFilter(inputChannel, outputChannel);
    } else {
      this.processWithRNNoise(inputChannel, outputChannel);
    }
    
    return true;
  }
  
  processWithSimpleFilter(inputChannel, outputChannel) {
    // Улучшенный фильтр для демонстрации работы шумодава
    const sensitivity = this.sensitivity / 100; // Нормализуем 0-1
    
    // Анализируем энергию сигнала
    let energy = 0;
    let maxSample = 0;
    for (let i = 0; i < inputChannel.length; i++) {
      const sample = Math.abs(inputChannel[i]);
      energy += sample * sample;
      maxSample = Math.max(maxSample, sample);
    }
    energy = Math.sqrt(energy / inputChannel.length);
    
    // Адаптивные пороги на основе чувствительности (более заметные)
    const noiseThreshold = 0.001 + (1 - sensitivity) * 0.05; // от 0.001 до 0.051
    const signalThreshold = 0.01 + sensitivity * 0.1; // от 0.01 до 0.11
    const maxThreshold = 0.05 + sensitivity * 0.3; // от 0.05 до 0.35
    
    // Определяем коэффициент подавления для всего фрейма
    let suppressionFactor;
    if (maxSample > maxThreshold || energy > signalThreshold) {
      // Явно речь - минимальное подавление
      suppressionFactor = 0.9 + sensitivity * 0.1; // от 0.9 до 1.0
    } else if (energy < noiseThreshold && maxSample < noiseThreshold * 3) {
      // Явно шум - сильное подавление
      suppressionFactor = (1 - sensitivity) * 0.2; // от 0.2 до 0.0
    } else {
      // Неопределенная область - умеренное подавление
      suppressionFactor = 0.2 + sensitivity * 0.6; // от 0.2 до 0.8
    }
    
    // Применяем подавление
    for (let i = 0; i < inputChannel.length; i++) {
      let sample = inputChannel[i];
      
      // Применяем основное подавление
      sample *= suppressionFactor;
      
      // Дополнительный высокочастотный фильтр для удаления шипения
      if (i > 0 && sensitivity > 0.5) {
        const highPassStrength = (sensitivity - 0.5) * 0.3;
        sample = sample - highPassStrength * inputChannel[i - 1];
      }
      
      // Ограничиваем амплитуду
      sample = Math.max(-1, Math.min(1, sample));
      
      outputChannel[i] = sample;
    }
    
    this.processedFrames++;
    
    // Логируем каждые 1000 фреймов для отладки
    if (this.processedFrames % 1000 === 0) {
      console.log(`🔇 Фильтр: энергия=${energy.toFixed(4)}, макс=${maxSample.toFixed(4)}, подавление=${suppressionFactor.toFixed(2)}, чувствительность=${this.sensitivity}%`);
    }
  }
  
  processWithRNNoise(inputChannel, outputChannel) {
    // Накапливаем сэмплы в буфере до достижения frameSize
    for (let i = 0; i < inputChannel.length; i++) {
      this.inputBuffer[this.bufferIndex] = inputChannel[i];
      this.bufferIndex++;
      
      // Когда буфер заполнен, обрабатываем фрейм
      if (this.bufferIndex >= this.frameSize) {
        this.processFrame();
        this.bufferIndex = 0;
      }
    }
    
    // Выводим обработанные сэмплы
    const samplesToOutput = Math.min(inputChannel.length, this.outputBuffer.length);
    for (let i = 0; i < samplesToOutput; i++) {
      outputChannel[i] = this.outputBuffer[i] || 0;
    }
  }
  
  processFrame() {
    if (!this.wasmModule || !this.rnnoiseState) {
      return;
    }
    
    try {
      // Копируем данные в WASM память
      const inputArray = new Float32Array(
        this.wasmModule.HEAPF32.buffer,
        this.inputPtr,
        this.frameSize
      );
      inputArray.set(this.inputBuffer);
      
      // Обрабатываем фрейм с помощью RNNoise
      this.wasmModule._rnnoise_process_frame(
        this.rnnoiseState,
        this.outputPtr,
        this.inputPtr
      );
      
      // Копируем результат обратно
      const outputArray = new Float32Array(
        this.wasmModule.HEAPF32.buffer,
        this.outputPtr,
        this.frameSize
      );
      this.outputBuffer.set(outputArray);
      
      this.processedFrames++;
    } catch (error) {
      console.error('🔇 Ошибка обработки фрейма RNNoise:', error);
      // Fallback: копируем входные данные без изменений
      this.outputBuffer.set(this.inputBuffer);
    }
  }
  
  // Очистка ресурсов при завершении
  static get parameterDescriptors() {
    return [];
  }
}

// Регистрируем процессор
registerProcessor('rnnoise-processor', RNNoiseProcessor); 