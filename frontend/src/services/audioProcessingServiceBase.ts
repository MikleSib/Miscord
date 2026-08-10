import { useAudioDeviceStore } from '../store/audioDeviceStore';
import {
  type NoiseSuppressionEngine,
  type NoiseSuppressionRuntimeStatus,
  useNoiseSuppressionStore,
} from '../store/noiseSuppressionStore';
import { MiscordNoiseSuppressor } from './miscordNoiseSuppressor';
import {
  DeepFilterNet3NoiseSuppressor,
  type DeepFilterNet3PerfMetrics,
} from './deepFilterNet3NoiseSuppressor';
import { preloadVadRuntime } from './audioProcessingVad';
import {
  configureMonoDestination,
  switchToDryBeforeTeardown,
} from './audioProcessingGraph';
import {
  createEmptyDiagnostics,
  DEFAULT_AUDIO_PROCESSING_CONFIG,
  type AudioProcessingConfig,
  type AudioProcessingDiagnostics,
  type AudioProcessingServiceOptions,
  type SupportedNoiseSuppressionEngine,
} from './audioProcessingTypes';
import { linearGain } from './voiceSettingsLogic';

const NEURAL_OUTPUT_MAKEUP = 1.3;

export abstract class AudioProcessingServiceBase {
  protected readonly miscordNoiseSuppressor = new MiscordNoiseSuppressor();
  protected readonly deepFilterNet3NoiseSuppressor =
    new DeepFilterNet3NoiseSuppressor();
  protected readonly publishRuntimeStatus: boolean;
  protected readonly onRuntimeStatus?: AudioProcessingServiceOptions['onRuntimeStatus'];
  protected diagnostics: AudioProcessingDiagnostics = createEmptyDiagnostics();
  protected preloadPromise: Promise<void> | null = null;
  protected audioContext: AudioContext | null = null;
  protected sourceNode: MediaStreamAudioSourceNode | null = null;
  protected destinationNode: MediaStreamAudioDestinationNode | null = null;
  protected inputGainNode: GainNode | null = null;
  protected highPassNode: BiquadFilterNode | null = null;
  protected dryGainNode: GainNode | null = null;
  protected wetGainNode: GainNode | null = null;
  protected compressorNode: DynamicsCompressorNode | null = null;
  protected makeupGainNode: GainNode | null = null;
  protected muteGainNode: GainNode | null = null;
  protected aiNode: AudioWorkletNode | null = null;
  protected deepFilterNet3Node: AudioWorkletNode | null = null;
  protected inputVolumePercent = 100;
  protected analyser: AnalyserNode | null = null;
  protected analyserSource: MediaStreamAudioSourceNode | null = null;
  protected volumeAnimationFrame: number | null = null;
  protected pipelineGeneration = 0;
  protected transitionGeneration = 0;
  protected lifecycleGeneration = 0;
  protected currentVolume = 0;
  protected muted = false;
  protected speaking = false;
  protected activeEngine: NoiseSuppressionEngine | null = null;
  protected config: AudioProcessingConfig = { ...DEFAULT_AUDIO_PROCESSING_CONFIG };
  protected onSpeechStart?: () => void;
  protected onSpeechEnd?: () => void;
  protected onVolumeChange?: (volume: number) => void;

  constructor(options: AudioProcessingServiceOptions = {}) {
    this.publishRuntimeStatus = options.publishRuntimeStatus ?? true;
    this.onRuntimeStatus = options.onRuntimeStatus;
  }

  protected abstract activateBrowserSuppression(
    fallback: boolean,
    message?: string,
    generation?: number,
    token?: number,
  ): Promise<void>;
  protected abstract applyCaptureConstraints(enabled: boolean, engine: NoiseSuppressionEngine): Promise<void>;
  protected abstract crossfadeToAI(useAI: boolean, durationSeconds?: number): void;
  protected abstract handleAIFailure(message: string): Promise<void>;
  protected abstract initializeVAD(
    stream: MediaStream,
    pipelineGeneration?: number,
    lifecycleGeneration?: number,
  ): Promise<void>;
  protected abstract setRuntimeStatus(
    status: NoiseSuppressionRuntimeStatus,
    message: string | null,
    engine: NoiseSuppressionEngine | null,
  ): void;
  abstract destroy(
    resetRuntimeStatus?: boolean,
    lifecycleRequest?: number,
  ): Promise<void>;

  protected async activateSelectedNeuralEngine(
    token = this.transitionGeneration,
  ): Promise<void> {
    if (this.config.noiseSuppressionEngine === 'deepfilternet3') {
      await this.activateDeepFilterNet3(this.pipelineGeneration, token);
      return;
    }
    await this.activateMiscordAI(this.pipelineGeneration, token);
  }

  getSupportedEngines(): SupportedNoiseSuppressionEngine[] {
    return [
      { engine: 'deepfilternet3', supported: DeepFilterNet3NoiseSuppressor.isSupported(), name: 'DeepFilterNet3' },
      { engine: 'miscord-ai', supported: MiscordNoiseSuppressor.isSupported(), name: 'Miscord AI' },
      { engine: 'browser', supported: true, name: 'Стандартное' },
    ];
  }

  async preloadHeavyAssets(): Promise<void> {
    if (typeof window === 'undefined') return this.preloadPromise ?? Promise.resolve();
    if (!this.preloadPromise) {
      this.preloadPromise = Promise.allSettled([
        this.deepFilterNet3NoiseSuppressor.preload(),
        this.miscordNoiseSuppressor.preload(),
        preloadVadRuntime(),
      ]).then(() => undefined);
    }
    return this.preloadPromise;
  }

  async initialize(
    stream: MediaStream,
    config: Partial<AudioProcessingConfig> = {},
  ): Promise<MediaStream> {
    const lifecycleRequest = ++this.lifecycleGeneration;
    await this.destroy(true, lifecycleRequest);
    if (lifecycleRequest !== this.lifecycleGeneration) return stream;
    const generation = ++this.pipelineGeneration;
    const token = ++this.transitionGeneration;
    const storedSettings = useNoiseSuppressionStore.getState();
    this.config = {
      ...this.config,
      ...config,
      noiseSuppression: config.noiseSuppression ?? storedSettings.enabled,
      noiseSuppressionEngine: config.noiseSuppressionEngine ?? storedSettings.engine,
    };

    try {
      this.createBaseGraph(stream);
      if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
      if (
        lifecycleRequest !== this.lifecycleGeneration ||
        !this.isOperationCurrent(generation, token)
      ) return stream;
      this.inputVolumePercent = useAudioDeviceStore.getState().inputVolume ?? 100;
      this.configureVoiceNodes();
      this.connectBaseGraph();

      if (!this.config.noiseSuppression) {
        await this.applyCaptureConstraints(false, 'browser');
        if (
          !this.isOperationCurrent(generation, token) ||
          this.config.noiseSuppression
        ) return stream;
        this.crossfadeToAI(false, 0);
        this.setRuntimeStatus('idle', null, null);
      } else if (this.config.noiseSuppressionEngine !== 'browser') {
        await this.activateSelectedNeuralEngine(token);
      } else {
        await this.activateBrowserSuppression(false);
      }

      if (
        lifecycleRequest !== this.lifecycleGeneration ||
        generation !== this.pipelineGeneration ||
        !this.destinationNode
      ) return stream;
      const processedStream = this.destinationNode.stream;
      if (this.config.vadEnabled) {
        await this.initializeVAD(
          processedStream,
          generation,
          lifecycleRequest,
        );
        if (
          lifecycleRequest !== this.lifecycleGeneration ||
          generation !== this.pipelineGeneration
        ) return stream;
      }
      return processedStream;
    } catch (error) {
      if (
        lifecycleRequest !== this.lifecycleGeneration ||
        !this.isOperationCurrent(generation, token)
      ) return stream;
      console.error('[Audio] Failed to initialize processing pipeline:', error);
      this.setRuntimeStatus(
        'error',
        'Не удалось запустить обработку звука. Используется исходный микрофон.',
        null,
      );
      await this.destroy(false);
      return stream;
    }
  }

  private createBaseGraph(stream: MediaStream): void {
    this.audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.destinationNode = this.audioContext.createMediaStreamDestination();
    configureMonoDestination(this.destinationNode);
    this.inputGainNode = this.audioContext.createGain();
    this.highPassNode = this.audioContext.createBiquadFilter();
    this.dryGainNode = this.audioContext.createGain();
    this.wetGainNode = this.audioContext.createGain();
    this.compressorNode = this.audioContext.createDynamicsCompressor();
    this.makeupGainNode = this.audioContext.createGain();
    this.muteGainNode = this.audioContext.createGain();
  }

  private configureVoiceNodes(): void {
    if (!this.dryGainNode || !this.wetGainNode || !this.muteGainNode) return;
    this.applyVoiceConditioning();
    this.dryGainNode.gain.value = 1;
    this.wetGainNode.gain.value = 0;
    this.muteGainNode.gain.value = this.muted ? 0 : 1;
    this.applyInputVolumeGain();
  }

  protected usesNeuralEngine(): boolean {
    const engine = this.activeEngine ?? this.config.noiseSuppressionEngine;
    return this.config.noiseSuppression && engine !== 'browser';
  }

  protected applyVoiceConditioning(): void {
    if (!this.highPassNode || !this.compressorNode || !this.makeupGainNode) return;
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
      this.compressorNode.threshold.value = -20;
      this.compressorNode.knee.value = 14;
      this.compressorNode.ratio.value = 1.4;
      this.compressorNode.attack.value = 0.005;
      this.compressorNode.release.value = 0.22;
      this.makeupGainNode.gain.value = NEURAL_OUTPUT_MAKEUP;
    } else {
      this.compressorNode.threshold.value = -26;
      this.compressorNode.knee.value = 18;
      this.compressorNode.ratio.value = 1.8;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.18;
      this.makeupGainNode.gain.value = 1.55;
    }
    this.applyInputVolumeGain();
  }

  private connectBaseGraph(): void {
    if (
      !this.sourceNode || !this.inputGainNode || !this.highPassNode ||
      !this.dryGainNode || !this.wetGainNode || !this.compressorNode ||
      !this.makeupGainNode || !this.muteGainNode || !this.destinationNode
    ) throw new Error('Audio graph nodes are incomplete');

    this.sourceNode.connect(this.inputGainNode);
    this.inputGainNode.connect(this.highPassNode);
    this.highPassNode.connect(this.dryGainNode);
    this.dryGainNode.connect(this.compressorNode);
    this.wetGainNode.connect(this.compressorNode);
    this.compressorNode.connect(this.makeupGainNode);
    this.makeupGainNode.connect(this.muteGainNode);
    this.muteGainNode.connect(this.destinationNode);
  }

  protected applyInputVolumeGain(): void {
    if (this.inputGainNode) this.inputGainNode.gain.value = linearGain(this.inputVolumePercent);
  }

  private teardownWithDryHandoff(active: boolean, teardown: () => void): void {
    if (
      active &&
      this.audioContext &&
      this.dryGainNode &&
      this.wetGainNode
    ) {
      switchToDryBeforeTeardown(
        this.dryGainNode.gain,
        this.wetGainNode.gain,
        this.audioContext.currentTime,
        teardown,
      );
      return;
    }
    teardown();
  }

  protected destroyNeuralEnginesForTransition(): void {
    this.teardownWithDryHandoff(
      Boolean(this.aiNode || this.deepFilterNet3Node),
      () => {
        this.miscordNoiseSuppressor.destroy();
        this.deepFilterNet3NoiseSuppressor.destroy();
        this.aiNode = null;
        this.deepFilterNet3Node = null;
        this.activeEngine = null;
        this.clearDeepFilterNet3Diagnostics();
      },
    );
  }

  private destroyMiscordAIForTransition(): void {
    this.teardownWithDryHandoff(Boolean(this.aiNode), () => {
      this.miscordNoiseSuppressor.destroy();
      this.aiNode = null;
      if (this.activeEngine === 'miscord-ai') this.activeEngine = null;
    });
  }

  private destroyDeepFilterNet3ForTransition(): void {
    this.teardownWithDryHandoff(Boolean(this.deepFilterNet3Node), () => {
      this.deepFilterNet3NoiseSuppressor.destroy();
      this.deepFilterNet3Node = null;
      if (this.activeEngine === 'deepfilternet3') this.activeEngine = null;
      this.clearDeepFilterNet3Diagnostics();
    });
  }

  setInputVolume(percent: number): void {
    this.inputVolumePercent = Math.min(100, Math.max(0, Math.round(percent)));
    useAudioDeviceStore.getState().setInputVolume(this.inputVolumePercent);
    this.applyInputVolumeGain();
  }

  getInputVolume(): number {
    return this.inputVolumePercent;
  }

  protected isOperationCurrent(generation: number, token: number): boolean {
    return generation === this.pipelineGeneration && token === this.transitionGeneration;
  }

  protected isTransitionCurrent(
    token: number,
    engine: NoiseSuppressionEngine | null,
    generation = this.pipelineGeneration,
  ): boolean {
    return this.isOperationCurrent(generation, token) &&
      this.config.noiseSuppression &&
      (engine === null || this.config.noiseSuppressionEngine === engine);
  }

  private isActiveNeuralNodeCurrent(
    generation: number,
    engine: Exclude<NoiseSuppressionEngine, 'browser'>,
    node: AudioWorkletNode | null,
  ): boolean {
    if (
      generation !== this.pipelineGeneration ||
      !this.config.noiseSuppression
    ) return false;
    return engine === 'miscord-ai'
      ? node !== null && node === this.aiNode
      : node !== null && node === this.deepFilterNet3Node;
  }

  protected async activateMiscordAI(
    generation = this.pipelineGeneration,
    token = this.transitionGeneration,
  ): Promise<void> {
    await this.startMiscordAI(
      generation,
      token,
      'miscord-ai',
      'active',
      'Обработка выполняется локально на устройстве.',
    );
  }

  protected async startMiscordAI(
    generation: number,
    token: number,
    expectedEngine: NoiseSuppressionEngine | null,
    status: 'active' | 'fallback',
    message: string,
  ): Promise<boolean> {
    if (!this.audioContext || !this.highPassNode || !this.wetGainNode) return false;
    if (!this.isTransitionCurrent(token, expectedEngine, generation)) return false;
    this.destroyDeepFilterNet3ForTransition();
    this.setRuntimeStatus('loading', 'Загрузка локальной нейросети…', null);
    await this.applyCaptureConstraints(true, 'miscord-ai');
    if (!this.isTransitionCurrent(token, expectedEngine, generation)) return false;

    let createdNode: AudioWorkletNode | null = null;
    let processorFailed = false;
    try {
      if (!this.aiNode) {
        createdNode = await this.miscordNoiseSuppressor.createNode(this.audioContext);
        if (!this.isTransitionCurrent(token, expectedEngine, generation)) {
          this.miscordNoiseSuppressor.destroyNode(createdNode);
          return false;
        }
        this.aiNode = createdNode;
        const node = createdNode;
        node.addEventListener('processorerror', () => {
          if (!this.isActiveNeuralNodeCurrent(generation, 'miscord-ai', node)) return;
          processorFailed = true;
          void this.handleAIFailure('AI-процессор остановился. Включено стандартное шумоподавление.');
        });
        this.highPassNode.connect(node);
        node.connect(this.wetGainNode);
        await this.miscordNoiseSuppressor.warmUp();
        if (
          processorFailed ||
          !this.isTransitionCurrent(token, expectedEngine, generation) ||
          this.aiNode !== node
        ) {
          if (this.aiNode === node) this.aiNode = null;
          this.miscordNoiseSuppressor.destroyNode(node);
          return false;
        }
      }
      if (!this.isTransitionCurrent(token, expectedEngine, generation)) return false;
      this.crossfadeToAI(true);
      this.activeEngine = 'miscord-ai';
      this.applyVoiceConditioning();
      this.setRuntimeStatus(status, message, 'miscord-ai');
      return true;
    } catch (error) {
      if (createdNode) {
        if (this.aiNode === createdNode) this.aiNode = null;
        this.miscordNoiseSuppressor.destroyNode(createdNode);
      }
      if (!this.isTransitionCurrent(token, expectedEngine, generation)) return false;
      console.error('[Miscord AI] Initialization failed:', error);
      if (expectedEngine === 'miscord-ai') {
        await this.handleAIFailure('Miscord AI недоступен. Включено стандартное шумоподавление.');
      }
      return false;
    }
  }

  private async activateDeepFilterNet3(
    generation = this.pipelineGeneration,
    token = this.transitionGeneration,
  ): Promise<void> {
    if (!this.audioContext || !this.highPassNode || !this.wetGainNode) return;
    if (!this.isTransitionCurrent(token, 'deepfilternet3', generation)) return;
    this.destroyMiscordAIForTransition();
    this.setRuntimeStatus('loading', 'Загрузка DeepFilterNet3…', null);
    await this.applyCaptureConstraints(true, 'deepfilternet3');
    if (!this.isTransitionCurrent(token, 'deepfilternet3', generation)) return;

    let createdNode: AudioWorkletNode | null = null;
    try {
      if (!this.deepFilterNet3Node) {
        createdNode = await this.deepFilterNet3NoiseSuppressor.createNode(
          this.audioContext,
          {
            onPerf: (metrics) => {
              if (!this.isActiveNeuralNodeCurrent(
                generation,
                'deepfilternet3',
                createdNode,
              )) return;
              this.updateDeepFilterNet3Diagnostics(metrics);
            },
            onRealtimeOverload: () => {
              if (!this.isActiveNeuralNodeCurrent(
                generation,
                'deepfilternet3',
                createdNode,
              )) return;
              if (!useNoiseSuppressionStore.getState().autoFallback) return;
              void this.handleAIFailure(
                'DeepFilterNet3 не успевает обрабатывать звук в реальном времени.',
              );
            },
          },
        );
        if (!this.isTransitionCurrent(token, 'deepfilternet3', generation)) {
          this.deepFilterNet3NoiseSuppressor.destroyNode(createdNode);
          return;
        }
        this.deepFilterNet3Node = createdNode;
        const node = createdNode;
        node.addEventListener('processorerror', () => {
          if (!this.isActiveNeuralNodeCurrent(
            generation,
            'deepfilternet3',
            node,
          )) return;
          void this.handleAIFailure('DeepFilterNet3 остановился.');
        });
        this.highPassNode.connect(node);
        node.connect(this.wetGainNode);
        await this.deepFilterNet3NoiseSuppressor.warmUp();
        if (
          !this.isTransitionCurrent(token, 'deepfilternet3', generation) ||
          this.deepFilterNet3Node !== node
        ) {
          if (this.deepFilterNet3Node === node) this.deepFilterNet3Node = null;
          this.deepFilterNet3NoiseSuppressor.destroyNode(node);
          return;
        }
      }
      if (!this.isTransitionCurrent(token, 'deepfilternet3', generation)) return;
      this.crossfadeToAI(true, 0.005);
      this.activeEngine = 'deepfilternet3';
      this.applyVoiceConditioning();
      this.setRuntimeStatus(
        'active',
        'DeepFilterNet3 обрабатывает звук локально на устройстве.',
        'deepfilternet3',
      );
    } catch (error) {
      if (createdNode) {
        if (this.deepFilterNet3Node === createdNode) this.deepFilterNet3Node = null;
        this.deepFilterNet3NoiseSuppressor.destroyNode(createdNode);
      }
      if (!this.isTransitionCurrent(token, 'deepfilternet3', generation)) return;
      console.error('[DeepFilterNet3] Initialization failed:', error);
      await this.handleAIFailure('DeepFilterNet3 недоступен.');
    }
  }

  protected updateDeepFilterNet3Diagnostics(
    metrics: DeepFilterNet3PerfMetrics,
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      lsnr: metrics.lsnr,
      wetRms: metrics.wetRms,
      dryRms: metrics.dryRms,
      rtf: metrics.rtf,
      overloadRatio: metrics.overloadRatio,
      glitchSamples: metrics.glitchSamples,
      droppedSamples: metrics.droppedSamples,
    };
  }

  protected clearDeepFilterNet3Diagnostics(): void {
    this.diagnostics = {
      ...this.diagnostics,
      lsnr: null,
      wetRms: null,
      dryRms: null,
      rtf: null,
      overloadRatio: null,
      glitchSamples: null,
      droppedSamples: null,
    };
  }
}
