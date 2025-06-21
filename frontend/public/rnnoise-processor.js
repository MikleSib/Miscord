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
    // Продвинутый фильтр для демонстрации работы шумодава
    const sensitivity = this.sensitivity / 100; // Нормализуем 0-1
    
    for (let i = 0; i < inputChannel.length; i++) {
      let sample = inputChannel[i];
      
      // Адаптивное подавление шума на основе чувствительности
      const noiseThreshold = 0.01 * (1 - sensitivity); // Чем выше чувствительность, тем ниже порог
      
      if (Math.abs(sample) < noiseThreshold) {
        // Подавляем тихие звуки (предполагаемый шум)
        sample *= 0.1 * sensitivity; // Чем выше чувствительность, тем сильнее подавление
      } else {
        // Для громких звуков (предполагаемая речь) применяем легкую обработку
        sample *= 0.95 + 0.05 * sensitivity; // Небольшое усиление/ослабление
      }
      
      // Простой высокочастотный фильтр для удаления низкочастотного шума
      if (i > 0) {
        const highPassStrength = 0.05 + 0.15 * sensitivity; // Сила фильтра зависит от чувствительности
        sample = sample - highPassStrength * inputChannel[i - 1];
      }
      
      // Ограничиваем амплитуду
      sample = Math.max(-1, Math.min(1, sample));
      
      outputChannel[i] = sample;
    }
    
    this.processedFrames++;
    
    // Логируем каждые 1000 фреймов для отладки
    if (this.processedFrames % 1000 === 0) {
      console.log(`🔇 RNNoise Processor обработал ${this.processedFrames} фреймов, чувствительность: ${this.sensitivity}%`);
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