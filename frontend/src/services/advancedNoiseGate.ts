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
  
  // Параметры noise gate
  private threshold: number = 0.05; // Порог срабатывания (увеличен для агрессивности)
  private attack: number = 0.002; // Время атаки (сек) - быстрее реагирует
  private release: number = 0.05; // Время отпускания (сек) - быстрее закрывается
  private ratio: number = 20; // Соотношение подавления (более агрессивное)
  
  // Буферы для анализа
  private frequencyData: Uint8Array | null = null;
  private timeData: Uint8Array | null = null;
  private isProcessing: boolean = false;
  
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
    
    // Настройка анализатора
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.3;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    
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
      this.analyser.getByteFrequencyData(this.frequencyData);
      this.analyser.getByteTimeDomainData(this.timeData);
      
      // Анализируем уровень сигнала
      const { rms, peakLevel, speechProbability } = this.analyzeSignal();
      
      // Применяем noise gate на основе анализа
      const currentTime = this.audioContext!.currentTime;
      const targetGain = this.calculateGateGain(rms, peakLevel, speechProbability);
      
      // Логируем каждые 100 кадров (примерно 2 раза в секунду)
      if (frameCount++ % 100 === 0) {
        console.log(`AdvancedNoiseGate: RMS=${rms.toFixed(3)}, Peak=${peakLevel.toFixed(3)}, Speech=${speechProbability.toFixed(2)}, Gain=${targetGain.toFixed(3)}`);
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
    
    // Вычисляем RMS (среднеквадратичное значение)
    let sum = 0;
    let peak = 0;
    
    for (let i = 0; i < this.timeData.length; i++) {
      const sample = (this.timeData[i] - 128) / 128; // Нормализуем к [-1, 1]
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    
    const rms = Math.sqrt(sum / this.timeData.length);
    
    // Анализ частотного спектра для определения вероятности речи
    let lowFreqEnergy = 0;
    let midFreqEnergy = 0;
    let highFreqEnergy = 0;
    
    const binWidth = this.audioContext!.sampleRate / (2 * this.frequencyData.length);
    
    for (let i = 0; i < this.frequencyData.length; i++) {
      const freq = i * binWidth;
      const magnitude = this.frequencyData[i] / 255;
      
      if (freq < 200) {
        lowFreqEnergy += magnitude * 0.5; // Меньший вес низким частотам (дыхание)
      } else if (freq >= 200 && freq < 800) {
        midFreqEnergy += magnitude * 1.5; // Больший вес основным частотам речи
      } else if (freq >= 800 && freq < 3000) {
        midFreqEnergy += magnitude; // Нормальный вес верхним частотам речи  
      } else if (freq >= 3000 && freq < 6000) {
        highFreqEnergy += magnitude * 0.7; // Меньший вес высоким частотам
      } else {
        highFreqEnergy += magnitude * 0.3; // Минимальный вес очень высоким частотам (клики)
      }
    }
    
    // Нормализуем энергии
    const totalBins = this.frequencyData.length;
    const lowBins = Math.floor(300 / binWidth);
    const midBins = Math.floor(3000 / binWidth) - lowBins;
    const highBins = totalBins - lowBins - midBins;
    
    lowFreqEnergy /= lowBins || 1;
    midFreqEnergy /= midBins || 1;
    highFreqEnergy /= highBins || 1;
    
    // Эвристика для определения речи
    // Речь обычно имеет больше энергии в среднем диапазоне
    const speechProbability = midFreqEnergy * 2 / (lowFreqEnergy + midFreqEnergy + highFreqEnergy + 0.001);
    
    return { rms, peakLevel: peak, speechProbability: Math.min(speechProbability, 1) };
  }

  private calculateGateGain(rms: number, peak: number, speechProbability: number): number {
    // Адаптивный порог на основе вероятности речи
    const adaptiveThreshold = this.threshold * (1 - speechProbability * 0.7);
    
    // Дополнительная проверка на импульсные шумы (клики и клавиатура)
    const isPeakNoise = peak > rms * 3.5; // Более чувствительная детекция импульсов
    
    if (rms < adaptiveThreshold || isPeakNoise) {
      // Сигнал ниже порога или импульсный шум - сильно подавляем
      const suppressionFactor = isPeakNoise ? 0.01 : Math.pow(rms / adaptiveThreshold, this.ratio);
      return Math.max(suppressionFactor, 0.001);
    } else if (speechProbability > 0.6) {
      // Высокая вероятность речи - пропускаем полностью
      return 1.0;
    } else {
      // Средний случай - частичное пропускание
      return 0.7 + (speechProbability * 0.3);
    }
  }

  connectNodes(source: AudioNode, destination: AudioNode): void {
    console.log('AdvancedNoiseGate: Подключение узлов начато');
    const nodes = this.createNoiseSuppressionChain(source.context as AudioContext);
    
    // Подключаем цепочку
    source.connect(nodes[0]);
    console.log('AdvancedNoiseGate: Источник подключен к inputGain');
    
    for (let i = 0; i < nodes.length - 1; i++) {
      nodes[i].connect(nodes[i + 1]);
    }
    console.log(`AdvancedNoiseGate: Создана цепочка из ${nodes.length} узлов`);
    
    nodes[nodes.length - 1].connect(destination);
    console.log('AdvancedNoiseGate: OutputGain подключен к destination');
    
    // Подключаем анализатор параллельно
    if (this.lowShelf && this.analyser) {
      this.lowShelf.connect(this.analyser);
      console.log('AdvancedNoiseGate: Анализатор подключен для мониторинга');
    }
    
    console.log('AdvancedNoiseGate: Полная цепочка фильтров активна!');
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
    
    console.log('AdvancedNoiseGate уничтожен');
  }
}

export const advancedNoiseGate = new AdvancedNoiseGate(); 