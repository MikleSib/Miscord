import { MicVAD } from '@ricky0123/vad-web';
import {
  MiscordNoiseSuppressor,
} from './miscordNoiseSuppressor';
import {
  DeepFilterNet3NoiseSuppressor,
} from './deepFilterNet3NoiseSuppressor';
import {
  NoiseSuppressionEngine,
  NoiseSuppressionRuntimeStatus,
  useNoiseSuppressionStore,
} from '../store/noiseSuppressionStore';
import { useAudioDeviceStore } from '../store/audioDeviceStore';
import { linearGain } from './voiceSettingsLogic';

export type { NoiseSuppressionEngine } from '../store/noiseSuppressionStore';

export interface AudioProcessingConfig {
  vadEnabled: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  voiceConditioning: boolean;
  speechProbabilityThreshold: number;
  useAdvancedNoiseSuppression: boolean;
  noiseSuppressionEngine: NoiseSuppressionEngine;
}

interface SupportedNoiseSuppressionEngine {
  engine: NoiseSuppressionEngine;
  supported: boolean;
  name: string;
}

export interface AudioProcessingDiagnostics {
  status: NoiseSuppressionRuntimeStatus;
  message: string | null;
  configuredEngine: NoiseSuppressionEngine | null;
  activeEngine: NoiseSuppressionEngine | null;
  captureSettings: MediaTrackSettings | null;
  unsupportedConstraints: string[];
  /** Оценка SNR модели DeepFilterNet3 (дБ). */
  lsnr: number | null;
  /** RMS на выходе модели (тише ≈ лучше шумодав в паузах). */
  wetRms: number | null;
  /** RMS на входе модели до очистки. */
  dryRms: number | null;
  /** Real-time factor: >1 значит модель не успевает. */
  rtf: number | null;
}

/** ~+3.8 dB — прежнее makeup-усиление, перенесено до нейросети. */
const NEURAL_INPUT_MAKEUP = 1.55;

export interface AudioProcessingServiceOptions {
  publishRuntimeStatus?: boolean;
  onRuntimeStatus?: (
    status: NoiseSuppressionRuntimeStatus,
    message: string | null,
    engine: NoiseSuppressionEngine | null,
  ) => void;
}

/**
 * Low-latency microphone pipeline used by WebRTC.
 *
 * source -> inputGain -> rumble filter -> [dry | Miscord AI] -> compressor -> makeup -> mute -> output
 *
 * The dry and neural paths stay connected so switching never replaces the
 * MediaStreamTrack that is already attached to peer connections.
 */
export class AudioProcessingService {
  private readonly miscordNoiseSuppressor = new MiscordNoiseSuppressor();
  private readonly deepFilterNet3NoiseSuppressor =
    new DeepFilterNet3NoiseSuppressor();
  private readonly publishRuntimeStatus: boolean;
  private readonly onRuntimeStatus?: AudioProcessingServiceOptions['onRuntimeStatus'];
  private diagnostics: AudioProcessingDiagnostics = {
    status: 'idle',
    message: null,
    configuredEngine: null,
    activeEngine: null,
    captureSettings: null,
    unsupportedConstraints: [],
    lsnr: null,
    wetRms: null,
    dryRms: null,
    rtf: null,
  };
  private micVAD: MicVAD | null = null;
  private preloadPromise: Promise<void> | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private inputGainNode: GainNode | null = null;
  private highPassNode: BiquadFilterNode | null = null;
  private dryGainNode: GainNode | null = null;
  private wetGainNode: GainNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private makeupGainNode: GainNode | null = null;
  private muteGainNode: GainNode | null = null;
  private aiNode: AudioWorkletNode | null = null;
  private deepFilterNet3Node: AudioWorkletNode | null = null;
  /** Тихий генератор держит Web Audio → WebRTC поток «живым» в Chrome. */
  private keepAliveOscillator: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;
  private inputVolumePercent = 100;
  private analyser: AnalyserNode | null = null;
  private analyserSource: MediaStreamAudioSourceNode | null = null;
  private volumeAnimationFrame: number | null = null;
  private cpuWatchdogId: number | null = null;
  private pipelineGeneration = 0;
  private transitionGeneration = 0;
  private currentVolume = 0;
  private muted = false;
  private speaking = false;
  private activeEngine: NoiseSuppressionEngine | null = null;

  private config: AudioProcessingConfig = {
    // Silero VAD требует ONNX WASM — на части браузеров падает; голос работает без него.
    vadEnabled: false,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    voiceConditioning: true,
    speechProbabilityThreshold: 0.35,
    useAdvancedNoiseSuppression: true,
    noiseSuppressionEngine: 'deepfilternet3',
  };

  private onSpeechStart?: () => void;
  private onSpeechEnd?: () => void;
  private onVolumeChange?: (volume: number) => void;

  constructor(options: AudioProcessingServiceOptions = {}) {
    this.publishRuntimeStatus = options.publishRuntimeStatus ?? true;
    this.onRuntimeStatus = options.onRuntimeStatus;
  }

  getSupportedEngines(): SupportedNoiseSuppressionEngine[] {
    return [
      {
        engine: 'deepfilternet3',
        supported: DeepFilterNet3NoiseSuppressor.isSupported(),
        name: 'DeepFilterNet3',
      },
      {
        engine: 'miscord-ai',
        supported: MiscordNoiseSuppressor.isSupported(),
        name: 'Miscord AI',
      },
      {
        engine: 'browser',
        supported: true,
        name: 'Стандартное',
      },
    ];
  }

  /**
   * Прогревает тяжёлые ассеты (ONNX/VAD, RNNoise, DeepFilterNet3) заранее.
   * Без этого они грузятся в момент входа в голосовой канал и дают задержку в секунды.
   */
  async preloadHeavyAssets(): Promise<void> {
    if (typeof window === 'undefined') return this.preloadPromise ?? Promise.resolve();
    if (!this.preloadPromise) {
      this.preloadPromise = Promise.allSettled([
        this.miscordNoiseSuppressor.preload(),
        this.deepFilterNet3NoiseSuppressor.preload(),
        this.preloadVadRuntime(),
      ]).then(() => undefined);
    }
    return this.preloadPromise;
  }

  /**
   * Собирает VAD на беззвучном потоке и сразу разбирает: браузер кэширует
   * ort-wasm и модель silero, поэтому реальный запуск потом почти мгновенный.
   */
  private async preloadVadRuntime(): Promise<void> {
    if (typeof AudioContext === 'undefined') return;

    let context: AudioContext | null = null;
    let vad: MicVAD | null = null;
    try {
      context = new AudioContext({ sampleRate: 48000 });
      const silence = context.createMediaStreamDestination();
      const assetOrigin = `${window.location.origin}/`;
      vad = await MicVAD.new({
        getStream: async () => silence.stream,
        pauseStream: async () => undefined,
        resumeStream: async () => silence.stream,
        baseAssetPath: assetOrigin,
        onnxWASMBasePath: `${assetOrigin}onnx/`,
      });
    } catch (error) {
      console.warn('[Audio] Не удалось прогреть VAD заранее:', error);
    } finally {
      try {
        await vad?.destroy();
      } catch {
        // прогрев не критичен
      }
      try {
        await context?.close();
      } catch {
        // прогрев не критичен
      }
    }
  }

  async initialize(
    stream: MediaStream,
    config: Partial<AudioProcessingConfig> = {},
  ): Promise<MediaStream> {
    await this.destroy();
    const generation = ++this.pipelineGeneration;
    const token = ++this.transitionGeneration;
    const storedSettings = useNoiseSuppressionStore.getState();

    this.config = {
      ...this.config,
      ...config,
      noiseSuppression:
        config.noiseSuppression ?? storedSettings.enabled,
      noiseSuppressionEngine:
        config.noiseSuppressionEngine ?? storedSettings.engine,
    };

    try {
      this.audioContext = new AudioContext({
        sampleRate: 48000,
        latencyHint: 'interactive',
      });

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.destinationNode = this.audioContext.createMediaStreamDestination();
      this.inputGainNode = this.audioContext.createGain();
      this.highPassNode = this.audioContext.createBiquadFilter();
      this.dryGainNode = this.audioContext.createGain();
      this.wetGainNode = this.audioContext.createGain();
      this.compressorNode = this.audioContext.createDynamicsCompressor();
      this.makeupGainNode = this.audioContext.createGain();
      this.muteGainNode = this.audioContext.createGain();

      // Берём сохранённую громкость микрофона (по умолчанию 100%)
      this.inputVolumePercent = useAudioDeviceStore.getState().inputVolume ?? 100;

      this.configureVoiceNodes();
      this.connectBaseGraph();
      this.startDestinationKeepAlive();

      if (this.config.noiseSuppression) {
        if (this.config.noiseSuppressionEngine === 'miscord-ai') {
          await this.activateMiscordAI(generation, token);
        } else if (this.config.noiseSuppressionEngine === 'deepfilternet3') {
          await this.activateDeepFilterNet3(generation, token);
        } else {
          await this.activateBrowserSuppression(false);
        }
      } else {
        await this.applyCaptureConstraints(false, 'browser');
        this.crossfadeToAI(false, 0);
        this.setRuntimeStatus('idle', null, null);
      }

      if (generation !== this.pipelineGeneration || !this.destinationNode) {
        return stream;
      }

      const processedStream = this.destinationNode.stream;
      if (this.config.vadEnabled) {
        await this.initializeVAD(processedStream);
      }

      return processedStream;
    } catch (error) {
      console.error('[Audio] Failed to initialize processing pipeline:', error);
      this.setRuntimeStatus(
        'error',
        'Не удалось запустить обработку звука. Используется исходный микрофон.',
        null
      );
      await this.destroy(false);
      return stream;
    }
  }

  private configureVoiceNodes(): void {
    if (
      !this.inputGainNode ||
      !this.highPassNode ||
      !this.dryGainNode ||
      !this.wetGainNode ||
      !this.compressorNode ||
      !this.makeupGainNode ||
      !this.muteGainNode
    ) {
      return;
    }

    // Remove desk rumble and microphone handling noise before neural inference.
    this.applyVoiceConditioning();

    // Мягкий компрессор — не «приглушает» речь так сильно, как раньше.

    this.dryGainNode.gain.value = 1;
    this.wetGainNode.gain.value = 0;
    // Компенсация потерь после шумодава/компрессора — речь слышнее изначально.
    this.muteGainNode.gain.value = this.muted ? 0 : 1;
    this.applyInputVolumeGain();
  }

  private usesNeuralEngine(): boolean {
    const engine = this.activeEngine ?? this.config.noiseSuppressionEngine;
    return (
      this.config.noiseSuppression &&
      (engine === 'miscord-ai' || engine === 'deepfilternet3')
    );
  }

  private applyVoiceConditioning(): void {
    if (!this.highPassNode || !this.compressorNode || !this.makeupGainNode) {
      return;
    }

    if (!this.config.voiceConditioning) {
      this.highPassNode.type = 'allpass';
      this.highPassNode.frequency.value = 10;
      this.highPassNode.Q.value = 0.0001;
      this.compressorNode.threshold.value = 0;
      this.compressorNode.knee.value = 0;
      this.compressorNode.ratio.value = 1;
      this.compressorNode.attack.value = 0;
      this.compressorNode.release.value = 0;
      this.makeupGainNode.gain.value = 1;
      this.applyInputVolumeGain();
      return;
    }

    this.highPassNode.type = 'highpass';
    this.highPassNode.frequency.value = 72;
    this.highPassNode.Q.value = 0.72;

    if (this.usesNeuralEngine()) {
      // После нейросети не поднимаем остаточный шум: мягкий компрессор и makeup ≈ 1.
      this.compressorNode.threshold.value = -18;
      this.compressorNode.knee.value = 12;
      this.compressorNode.ratio.value = 1.3;
      this.compressorNode.attack.value = 0.005;
      this.compressorNode.release.value = 0.22;
      this.makeupGainNode.gain.value = 1;
    } else {
      this.compressorNode.threshold.value = -26;
      this.compressorNode.knee.value = 18;
      this.compressorNode.ratio.value = 1.8;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.18;
      this.makeupGainNode.gain.value = NEURAL_INPUT_MAKEUP;
    }

    this.applyInputVolumeGain();
  }

  private connectBaseGraph(): void {
    if (
      !this.sourceNode ||
      !this.inputGainNode ||
      !this.highPassNode ||
      !this.dryGainNode ||
      !this.wetGainNode ||
      !this.compressorNode ||
      !this.makeupGainNode ||
      !this.muteGainNode ||
      !this.destinationNode
    ) {
      throw new Error('Audio graph nodes are incomplete');
    }

    this.sourceNode.connect(this.inputGainNode);
    this.inputGainNode.connect(this.highPassNode);
    this.highPassNode.connect(this.dryGainNode);
    this.dryGainNode.connect(this.compressorNode);
    this.wetGainNode.connect(this.compressorNode);
    this.compressorNode.connect(this.makeupGainNode);
    this.makeupGainNode.connect(this.muteGainNode);
    this.muteGainNode.connect(this.destinationNode);
  }

  /**
   * Chrome иногда «замораживает» MediaStreamDestination без постоянного сигнала.
   * Подмешиваем неслышимый тон — на слух не влияет, WebRTC продолжает слать пакеты.
   */
  private startDestinationKeepAlive(): void {
    if (!this.audioContext || !this.destinationNode) return;

    this.stopDestinationKeepAlive();

    this.keepAliveOscillator = this.audioContext.createOscillator();
    this.keepAliveGain = this.audioContext.createGain();
    this.keepAliveOscillator.frequency.value = 20;
    this.keepAliveGain.gain.value = 0.0001;
    this.keepAliveOscillator.connect(this.keepAliveGain);
    this.keepAliveGain.connect(this.destinationNode);
    this.keepAliveOscillator.start();
  }

  private stopDestinationKeepAlive(): void {
    try {
      this.keepAliveOscillator?.stop();
    } catch {
      // already stopped
    }
    try {
      this.keepAliveOscillator?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.keepAliveGain?.disconnect();
    } catch {
      // ignore
    }
    this.keepAliveOscillator = null;
    this.keepAliveGain = null;
  }

  private applyInputVolumeGain(): void {
    if (!this.inputGainNode) return;
    const normalized = linearGain(this.inputVolumePercent);
    // Для нейросети прежнее makeup (+3.8 dB) перенесено сюда — до модели.
    const neuralBoost =
      this.config.voiceConditioning && this.usesNeuralEngine()
        ? NEURAL_INPUT_MAKEUP
        : 1;
    this.inputGainNode.gain.value = normalized * neuralBoost;
  }

  /** Громкость микрофона в процентах (по умолчанию 100). */
  setInputVolume(percent: number): void {
    this.inputVolumePercent = Math.min(100, Math.max(0, Math.round(percent)));
    useAudioDeviceStore.getState().setInputVolume(this.inputVolumePercent);
    this.applyInputVolumeGain();
  }

  getInputVolume(): number {
    return this.inputVolumePercent;
  }

  private isTransitionCurrent(token: number, engine: NoiseSuppressionEngine): boolean {
    return token === this.transitionGeneration && this.config.noiseSuppression && this.config.noiseSuppressionEngine === engine;
  }

  private async activateMiscordAI(generation = this.pipelineGeneration, token = this.transitionGeneration): Promise<void> {
    this.deepFilterNet3NoiseSuppressor.destroy();
    this.deepFilterNet3Node = null;
    this.clearDeepFilterNet3Diagnostics();
    if (!this.audioContext || !this.highPassNode || !this.wetGainNode) return;

    this.setRuntimeStatus('loading', 'Загрузка локальной нейросети…', null);
    await this.applyCaptureConstraints(true, 'miscord-ai');
    if (!this.isTransitionCurrent(token, 'miscord-ai') || generation !== this.pipelineGeneration) return;

    try {
      if (!this.aiNode) {
        this.aiNode = await this.miscordNoiseSuppressor.createNode(this.audioContext);
        if (!this.isTransitionCurrent(token, 'miscord-ai') || generation !== this.pipelineGeneration) {
          this.miscordNoiseSuppressor.destroy();
          this.aiNode = null;
          return;
        }
        this.aiNode.addEventListener('processorerror', () => {
          void this.handleAIFailure('AI-процессор остановился. Включено стандартное шумоподавление.');
        });
        this.highPassNode.connect(this.aiNode);
        this.aiNode.connect(this.wetGainNode);

        // RNNoise initializes its WASM instance inside the audio render thread.
        // Keep the dry path audible until the first neural frames are ready.
        await this.miscordNoiseSuppressor.warmUp();
        if (!this.isTransitionCurrent(token, 'miscord-ai') || generation !== this.pipelineGeneration) {
          this.miscordNoiseSuppressor.destroy();
          this.aiNode = null;
          return;
        }
      }

      if (!this.isTransitionCurrent(token, 'miscord-ai') || generation !== this.pipelineGeneration) return;

      this.crossfadeToAI(true);
      this.activeEngine = 'miscord-ai';
      this.applyVoiceConditioning();
      this.setRuntimeStatus('active', 'Обработка выполняется локально на устройстве.', 'miscord-ai');
      // Главный поток браузера не отражает нагрузку AudioWorklet — откат только по ошибке процессора.
    } catch (error) {
      console.error('[Miscord AI] Initialization failed:', error);
      await this.handleAIFailure('Miscord AI недоступен. Включено стандартное шумоподавление.');
    }
  }

  private async activateDeepFilterNet3(generation = this.pipelineGeneration, token = this.transitionGeneration): Promise<void> {
    if (!this.audioContext || !this.highPassNode || !this.wetGainNode) return;

    this.setRuntimeStatus('loading', 'Загрузка DeepFilterNet3…', null);
    await this.applyCaptureConstraints(true, 'deepfilternet3');
    if (!this.isTransitionCurrent(token, 'deepfilternet3') || generation !== this.pipelineGeneration) return;

    try {
      this.miscordNoiseSuppressor.destroy();
      this.aiNode = null;
      if (!this.deepFilterNet3Node) {
        this.deepFilterNet3Node = await this.deepFilterNet3NoiseSuppressor.createNode(this.audioContext, {
          onPerf: (metrics) => this.updateDeepFilterNet3Diagnostics(metrics),
          onRealtimeOverload: () => {
            if (!useNoiseSuppressionStore.getState().autoFallback) return;
            void this.handleAIFailure(
              'DeepFilterNet3 устойчиво не успевает в реальном времени. Включено стандартное шумоподавление.',
            );
          },
        });
        if (!this.isTransitionCurrent(token, 'deepfilternet3') || generation !== this.pipelineGeneration) {
          this.deepFilterNet3NoiseSuppressor.destroy();
          this.deepFilterNet3Node = null;
          return;
        }
        this.deepFilterNet3Node.addEventListener('processorerror', () => {
          void this.handleAIFailure('DeepFilterNet3 остановился. Включено стандартное шумоподавление.');
        });
        this.highPassNode.connect(this.deepFilterNet3Node);
        this.deepFilterNet3Node.connect(this.wetGainNode);
        await this.deepFilterNet3NoiseSuppressor.warmUp();
        if (!this.isTransitionCurrent(token, 'deepfilternet3') || generation !== this.pipelineGeneration) {
          this.deepFilterNet3NoiseSuppressor.destroy();
          this.deepFilterNet3Node = null;
          return;
        }
      }

      if (!this.isTransitionCurrent(token, 'deepfilternet3') || generation !== this.pipelineGeneration) return;
      this.crossfadeToAI(true, 0.005);
      this.activeEngine = 'deepfilternet3';
      this.applyVoiceConditioning();
      this.setRuntimeStatus('active', 'DeepFilterNet3 обрабатывает звук локально на устройстве.', 'deepfilternet3');
      // Откат только по устойчивому rtf из worklet — не по задержке главного потока.
    } catch (error) {
      console.error('[DeepFilterNet3] Initialization failed:', error);
      this.deepFilterNet3NoiseSuppressor.destroy();
      this.deepFilterNet3Node = null;
      await this.handleAIFailure('DeepFilterNet3 недоступен. Включено стандартное шумоподавление.');
    }
  }

  private async activateBrowserSuppression(
    fallback: boolean,
    message = 'Используется встроенная обработка WebRTC.'
  ): Promise<void> {
    this.stopCpuWatchdog();
    this.miscordNoiseSuppressor.destroy();
    this.deepFilterNet3NoiseSuppressor.destroy();
    this.aiNode = null;
    this.deepFilterNet3Node = null;
    await this.applyCaptureConstraints(true, 'browser');
    this.crossfadeToAI(false);
    this.activeEngine = 'browser';
    this.clearDeepFilterNet3Diagnostics();
    this.applyVoiceConditioning();
    this.setRuntimeStatus(fallback ? 'fallback' : 'active', message, 'browser');
  }

  private async handleAIFailure(message: string): Promise<void> {
    await this.activateBrowserSuppression(true, message);
  }

  async setNoiseSuppression(
    enabled: boolean,
    engine: NoiseSuppressionEngine = this.config.noiseSuppressionEngine
  ): Promise<void> {
    const token = ++this.transitionGeneration;
    this.config.noiseSuppression = enabled;
    this.config.noiseSuppressionEngine = engine;

    if (!this.audioContext || !this.sourceNode) {
      this.setRuntimeStatus('idle', null, null);
      return;
    }

    if (!enabled) {
      this.stopCpuWatchdog();
      await this.applyCaptureConstraints(false, engine);
      this.crossfadeToAI(false);
      this.activeEngine = null;
      this.clearDeepFilterNet3Diagnostics();
      this.applyVoiceConditioning();
      this.setRuntimeStatus('idle', 'Шумоподавление выключено.', null);
      return;
    }

    if (engine === 'miscord-ai') {
      await this.activateMiscordAI(this.pipelineGeneration, token);
      return;
    }

    if (engine === 'deepfilternet3') {
      await this.activateDeepFilterNet3(this.pipelineGeneration, token);
      return;
    }

    await this.activateBrowserSuppression(false);
  }

  private async applyCaptureConstraints(
    enabled: boolean,
    engine: NoiseSuppressionEngine
  ): Promise<void> {
    const track = this.sourceNode?.mediaStream.getAudioTracks()[0];
    if (!track) return;

    const usesBrowserDenoiser = enabled && engine === 'browser';
    const usesNeuralDenoiser =
      enabled && (engine === 'miscord-ai' || engine === 'deepfilternet3');
    const supported = navigator.mediaDevices.getSupportedConstraints();
    const unsupported = [
      !supported.echoCancellation ? 'echoCancellation' : null,
      !supported.noiseSuppression ? 'noiseSuppression' : null,
      !supported.autoGainControl ? 'autoGainControl' : null,
    ].filter((value): value is string => value !== null);

    try {
      await track.applyConstraints({
        echoCancellation: supported.echoCancellation
          ? this.config.echoCancellation
          : undefined,
        noiseSuppression: supported.noiseSuppression
          ? usesBrowserDenoiser
          : undefined,
        // AGC браузера мешает нейросети: шумовой фон «дышит» и хуже чистится.
        autoGainControl: supported.autoGainControl
          ? usesNeuralDenoiser
            ? false
            : this.config.autoGainControl
          : undefined,
        channelCount: supported.channelCount ? 1 : undefined,
      });
      this.diagnostics = {
        ...this.diagnostics,
        captureSettings: track.getSettings(),
        unsupportedConstraints: unsupported,
      };
    } catch (error) {
      console.warn('[Audio] Browser rejected updated capture constraints:', error);
    }
  }

  private crossfadeToAI(useAI: boolean, durationSeconds = 0.035): void {
    if (!this.audioContext || !this.dryGainNode || !this.wetGainNode) return;

    const now = this.audioContext.currentTime;
    const end = now + durationSeconds;
    // Полный переход на AI-ветку — максимальное шумоподавление Miscord AI.
    const dryTarget = useAI ? 0 : 1;
    const wetTarget = useAI ? 1 : 0;

    for (const [gain, target] of [
      [this.dryGainNode.gain, dryTarget],
      [this.wetGainNode.gain, wetTarget],
    ] as const) {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      if (durationSeconds > 0) {
        gain.linearRampToValueAtTime(target, end);
      } else {
        gain.setValueAtTime(target, now);
      }
    }
  }

  private stopCpuWatchdog(): void {
    if (this.cpuWatchdogId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.cpuWatchdogId);
    }
    this.cpuWatchdogId = null;
  }

  private updateDeepFilterNet3Diagnostics(metrics: {
    lsnr: number;
    wetRms: number;
    dryRms: number;
    rtf: number;
  }): void {
    this.diagnostics = {
      ...this.diagnostics,
      lsnr: metrics.lsnr,
      wetRms: metrics.wetRms,
      dryRms: metrics.dryRms,
      rtf: metrics.rtf,
    };
  }

  private clearDeepFilterNet3Diagnostics(): void {
    this.diagnostics = {
      ...this.diagnostics,
      lsnr: null,
      wetRms: null,
      dryRms: null,
      rtf: null,
    };
  }

  private setRuntimeStatus(
    status: NoiseSuppressionRuntimeStatus,
    message: string | null,
    engine: NoiseSuppressionEngine | null
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      status,
      message,
      configuredEngine: this.config.noiseSuppression
        ? this.config.noiseSuppressionEngine
        : null,
      activeEngine: engine,
      ...(engine !== 'deepfilternet3'
        ? { lsnr: null, wetRms: null, dryRms: null, rtf: null }
        : {}),
    };
    if (this.publishRuntimeStatus) {
      useNoiseSuppressionStore.getState().setRuntimeStatus(status, message, engine);
    }
    this.onRuntimeStatus?.(status, message, engine);
  }

  getDiagnostics(): AudioProcessingDiagnostics {
    return {
      ...this.diagnostics,
      captureSettings: this.diagnostics.captureSettings
        ? { ...this.diagnostics.captureSettings }
        : null,
      unsupportedConstraints: [...this.diagnostics.unsupportedConstraints],
    };
  }

  updateVADThresholds(sensitivity: number): void {
    const normalizedSensitivity = Math.max(0, Math.min(100, sensitivity)) / 100;
    this.config.speechProbabilityThreshold = 0.1 + 0.8 * normalizedSensitivity;

    if (this.micVAD && this.destinationNode) {
      void this.reinitializeVAD(this.destinationNode.stream);
    }
  }

  private async reinitializeVAD(stream: MediaStream): Promise<void> {
    if (this.micVAD) {
      await this.micVAD.destroy();
      this.micVAD = null;
    }
    await this.initializeVAD(stream);
  }

  private async initializeVAD(stream: MediaStream): Promise<void> {
    try {
      // Локальные ассеты из /public — без CDN, чтобы не ломать CSP на miscord.ru
      const assetOrigin =
        typeof window !== 'undefined' ? `${window.location.origin}/` : '/';

      this.micVAD = await MicVAD.new({
        getStream: async () => stream,
        pauseStream: async () => undefined,
        resumeStream: async () => stream,
        baseAssetPath: assetOrigin,
        onnxWASMBasePath: `${assetOrigin}onnx/`,
        onSpeechStart: () => {
          this.speaking = true;
          this.onSpeechStart?.();
        },
        onSpeechEnd: () => {
          this.speaking = false;
          this.onSpeechEnd?.();
        },
        onVADMisfire: () => {
          this.speaking = false;
        },
        positiveSpeechThreshold: this.config.speechProbabilityThreshold,
        negativeSpeechThreshold: Math.max(0.05, this.config.speechProbabilityThreshold - 0.15),
        redemptionMs: 768,
        preSpeechPadMs: 384,
        minSpeechMs: 384,
      });

      await this.micVAD.start();
    } catch (error) {
      console.error('[Audio] Failed to initialize VAD:', error);
    }
  }

  analyzeVolume(stream: MediaStream): void {
    if (!this.audioContext) return;

    if (this.volumeAnimationFrame !== null) {
      cancelAnimationFrame(this.volumeAnimationFrame);
    }
    this.analyserSource?.disconnect();
    this.analyser?.disconnect();

    const analysisStream = this.destinationNode?.stream ?? stream;
    this.analyser = this.audioContext.createAnalyser();
    this.analyserSource = this.audioContext.createMediaStreamSource(analysisStream);
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    this.analyserSource.connect(this.analyser);

    const data = new Uint8Array(this.analyser.frequencyBinCount);
    // Без Silero VAD зелёную рамку ведём по уровню громкости.
    let speechFrames = 0;
    let silenceFrames = 0;

    const checkVolume = () => {
      if (!this.analyser || this.audioContext?.state === 'closed') return;

      this.analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let index = 0; index < data.length; index += 1) {
        const sample = (data[index] - 128) / 128;
        sumSquares += sample * sample;
      }

      const rms = Math.sqrt(sumSquares / data.length);
      this.currentVolume = Math.min(100, rms * 220);
      this.onVolumeChange?.(this.currentVolume / 100);

      if (!this.config.vadEnabled && !this.muted) {
        if (this.currentVolume > 8) {
          speechFrames += 1;
          silenceFrames = 0;
          if (!this.speaking && speechFrames >= 3) {
            this.speaking = true;
            this.onSpeechStart?.();
          }
        } else {
          silenceFrames += 1;
          speechFrames = 0;
          if (this.speaking && silenceFrames >= 10) {
            this.speaking = false;
            this.onSpeechEnd?.();
          }
        }
      }

      this.volumeAnimationFrame = requestAnimationFrame(checkVolume);
    };

    checkVolume();
  }

  getCurrentVolume(): number {
    return this.currentVolume;
  }

  setOnSpeechStart(callback: () => void): void {
    this.onSpeechStart = callback;
  }

  setOnSpeechEnd(callback: () => void): void {
    this.onSpeechEnd = callback;
  }

  setOnVolumeChange(callback: (volume: number) => void): void {
    this.onVolumeChange = callback;
  }

  /** Перезапуск VAD после регистрации callbacks (initialize вызывается раньше) */
  async refreshSpeakingDetection(): Promise<void> {
    if (!this.config.vadEnabled || !this.destinationNode?.stream) return;
    await this.reinitializeVAD(this.destinationNode.stream);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.muteGainNode || !this.audioContext) return;

    const now = this.audioContext.currentTime;
    this.muteGainNode.gain.cancelScheduledValues(now);
    this.muteGainNode.gain.setValueAtTime(this.muteGainNode.gain.value, now);
    this.muteGainNode.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.01);
  }

  isMute(): boolean {
    return this.muted;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  updateConfig(config: Partial<AudioProcessingConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.voiceConditioning !== undefined) {
      this.applyVoiceConditioning();
    }

    if (
      config.noiseSuppression !== undefined ||
      config.noiseSuppressionEngine !== undefined
    ) {
      void this.setNoiseSuppression(
        this.config.noiseSuppression,
        this.config.noiseSuppressionEngine
      );
      return;
    }

    if (
      config.echoCancellation !== undefined ||
      config.autoGainControl !== undefined
    ) {
      void this.applyCaptureConstraints(
        this.config.noiseSuppression,
        this.activeEngine ?? this.config.noiseSuppressionEngine
      );
    }
  }

  async destroy(resetRuntimeStatus = true): Promise<void> {
    this.pipelineGeneration += 1;
    this.transitionGeneration += 1;
    this.stopCpuWatchdog();
    this.stopDestinationKeepAlive();

    if (this.volumeAnimationFrame !== null) {
      cancelAnimationFrame(this.volumeAnimationFrame);
      this.volumeAnimationFrame = null;
    }

    if (this.micVAD) {
      await this.micVAD.destroy();
      this.micVAD = null;
    }

    this.miscordNoiseSuppressor.destroy();
    this.deepFilterNet3NoiseSuppressor.destroy();

    const nodes: Array<AudioNode | null> = [
      this.analyserSource,
      this.analyser,
      this.sourceNode,
      this.inputGainNode,
      this.highPassNode,
      this.dryGainNode,
      this.wetGainNode,
      this.compressorNode,
      this.makeupGainNode,
      this.muteGainNode,
      this.aiNode,
      this.deepFilterNet3Node,
      this.destinationNode,
    ];
    nodes.forEach((node) => {
      try {
        node?.disconnect();
      } catch {
        // A node can already be disconnected after an AudioWorklet failure.
      }
    });
    this.aiNode = null;
    this.deepFilterNet3Node = null;

    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
    }

    this.audioContext = null;
    this.sourceNode = null;
    this.destinationNode = null;
    this.inputGainNode = null;
    this.highPassNode = null;
    this.dryGainNode = null;
    this.wetGainNode = null;
    this.compressorNode = null;
    this.makeupGainNode = null;
    this.muteGainNode = null;
    this.aiNode = null;
    this.analyser = null;
    this.analyserSource = null;
    this.currentVolume = 0;
    this.speaking = false;
    this.activeEngine = null;

    if (resetRuntimeStatus) {
      this.setRuntimeStatus('idle', null, null);
    }
  }
}

export const audioProcessingService = new AudioProcessingService();

