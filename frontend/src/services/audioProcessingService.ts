import { MicVAD } from '@ricky0123/vad-web';
import {
  MiscordNoiseSuppressor,
  miscordNoiseSuppressor,
} from './miscordNoiseSuppressor';
import {
  NoiseSuppressionEngine,
  NoiseSuppressionRuntimeStatus,
  useNoiseSuppressionStore,
} from '../store/noiseSuppressionStore';
import { useAudioDeviceStore } from '../store/audioDeviceStore';

export type { NoiseSuppressionEngine } from '../store/noiseSuppressionStore';

export interface AudioProcessingConfig {
  vadEnabled: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  speechProbabilityThreshold: number;
  useAdvancedNoiseSuppression: boolean;
  noiseSuppressionEngine: NoiseSuppressionEngine;
}

interface SupportedNoiseSuppressionEngine {
  engine: NoiseSuppressionEngine;
  supported: boolean;
  name: string;
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
  private micVAD: MicVAD | null = null;
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
  private inputVolumePercent = 100;
  private analyser: AnalyserNode | null = null;
  private analyserSource: MediaStreamAudioSourceNode | null = null;
  private volumeAnimationFrame: number | null = null;
  private cpuWatchdogId: number | null = null;
  private cpuExpectedAt = 0;
  private cpuOverloadStrikes = 0;
  private pipelineGeneration = 0;
  private currentVolume = 0;
  private muted = false;
  private speaking = false;
  private activeEngine: NoiseSuppressionEngine | null = null;

  private config: AudioProcessingConfig = {
    vadEnabled: true,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    speechProbabilityThreshold: 0.35,
    useAdvancedNoiseSuppression: true,
    noiseSuppressionEngine: 'miscord-ai',
  };

  private onSpeechStart?: () => void;
  private onSpeechEnd?: () => void;
  private onVolumeChange?: (volume: number) => void;

  getSupportedEngines(): SupportedNoiseSuppressionEngine[] {
    return [
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

  async initialize(stream: MediaStream): Promise<MediaStream> {
    await this.destroy();
    const generation = ++this.pipelineGeneration;
    const storedSettings = useNoiseSuppressionStore.getState();

    this.config.noiseSuppression = storedSettings.enabled;
    this.config.noiseSuppressionEngine = storedSettings.engine;

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

      if (this.config.noiseSuppression) {
        if (this.config.noiseSuppressionEngine === 'miscord-ai') {
          await this.activateMiscordAI(generation);
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
    this.highPassNode.type = 'highpass';
    this.highPassNode.frequency.value = 72;
    this.highPassNode.Q.value = 0.72;

    // Мягкий компрессор — не «приглушает» речь так сильно, как раньше.
    this.compressorNode.threshold.value = -26;
    this.compressorNode.knee.value = 18;
    this.compressorNode.ratio.value = 1.8;
    this.compressorNode.attack.value = 0.003;
    this.compressorNode.release.value = 0.18;

    this.dryGainNode.gain.value = 1;
    this.wetGainNode.gain.value = 0;
    // Компенсация потерь после шумодава/компрессора — речь слышнее изначально.
    this.makeupGainNode.gain.value = 1.55;
    this.muteGainNode.gain.value = this.muted ? 0 : 1;
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

  private applyInputVolumeGain(): void {
    if (!this.inputGainNode) return;
    const normalized = Math.min(100, Math.max(0, this.inputVolumePercent)) / 100;
    // 100% = полная громкость микрофона (без дополнительного затухания)
    this.inputGainNode.gain.value = normalized;
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

  private async activateMiscordAI(generation = this.pipelineGeneration): Promise<void> {
    if (!this.audioContext || !this.highPassNode || !this.wetGainNode) return;

    this.setRuntimeStatus('loading', 'Загрузка локальной нейросети…', null);
    await this.applyCaptureConstraints(true, 'miscord-ai');

    try {
      if (!this.aiNode) {
        this.aiNode = await miscordNoiseSuppressor.createNode(this.audioContext);
        this.aiNode.addEventListener('processorerror', () => {
          void this.handleAIFailure('AI-процессор остановился. Включено стандартное шумоподавление.');
        });
        this.highPassNode.connect(this.aiNode);
        this.aiNode.connect(this.wetGainNode);

        // RNNoise initializes its WASM instance inside the audio render thread.
        // Keep the dry path audible until the first neural frames are ready.
        await miscordNoiseSuppressor.warmUp();
      }

      if (generation !== this.pipelineGeneration) return;

      this.crossfadeToAI(true);
      this.activeEngine = 'miscord-ai';
      this.setRuntimeStatus('active', 'Обработка выполняется локально на устройстве.', 'miscord-ai');
      this.startCpuWatchdog();
    } catch (error) {
      console.error('[Miscord AI] Initialization failed:', error);
      await this.handleAIFailure('Miscord AI недоступен. Включено стандартное шумоподавление.');
    }
  }

  private async activateBrowserSuppression(
    fallback: boolean,
    message = 'Используется встроенная обработка WebRTC.'
  ): Promise<void> {
    this.stopCpuWatchdog();
    await this.applyCaptureConstraints(true, 'browser');
    this.crossfadeToAI(false);
    this.activeEngine = 'browser';
    this.setRuntimeStatus(fallback ? 'fallback' : 'active', message, 'browser');
  }

  private async handleAIFailure(message: string): Promise<void> {
    await this.activateBrowserSuppression(true, message);
  }

  async setNoiseSuppression(
    enabled: boolean,
    engine: NoiseSuppressionEngine = this.config.noiseSuppressionEngine
  ): Promise<void> {
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
      this.setRuntimeStatus('idle', 'Шумоподавление выключено.', null);
      return;
    }

    if (engine === 'miscord-ai') {
      await this.activateMiscordAI();
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

    try {
      await track.applyConstraints({
        echoCancellation: this.config.echoCancellation,
        noiseSuppression: usesBrowserDenoiser,
        // AGC всегда включён — иначе голос уходит слишком тихо
        autoGainControl: true,
        channelCount: 1,
      });
    } catch (error) {
      console.warn('[Audio] Browser rejected updated capture constraints:', error);
    }
  }

  private crossfadeToAI(useAI: boolean, durationSeconds = 0.035): void {
    if (!this.audioContext || !this.dryGainNode || !this.wetGainNode) return;

    const now = this.audioContext.currentTime;
    const end = now + durationSeconds;
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

  private startCpuWatchdog(): void {
    this.stopCpuWatchdog();
    if (typeof window === 'undefined') return;

    this.cpuOverloadStrikes = 0;
    this.cpuExpectedAt = performance.now() + 1000;
    this.cpuWatchdogId = window.setInterval(() => {
      const now = performance.now();

      if (document.hidden || this.audioContext?.state !== 'running') {
        this.cpuExpectedAt = now + 1000;
        this.cpuOverloadStrikes = 0;
        return;
      }

      const eventLoopDelay = now - this.cpuExpectedAt;
      this.cpuExpectedAt = now + 1000;
      this.cpuOverloadStrikes =
        eventLoopDelay > 220
          ? this.cpuOverloadStrikes + 1
          : Math.max(0, this.cpuOverloadStrikes - 1);

      if (
        this.cpuOverloadStrikes >= 3 &&
        useNoiseSuppressionStore.getState().autoFallback
      ) {
        this.stopCpuWatchdog();
        void this.activateBrowserSuppression(
          true,
          'Miscord AI временно отключён из-за высокой нагрузки на систему.'
        );
      }
    }, 1000);
  }

  private stopCpuWatchdog(): void {
    if (this.cpuWatchdogId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.cpuWatchdogId);
    }
    this.cpuWatchdogId = null;
    this.cpuOverloadStrikes = 0;
  }

  private setRuntimeStatus(
    status: NoiseSuppressionRuntimeStatus,
    message: string | null,
    engine: NoiseSuppressionEngine | null
  ): void {
    useNoiseSuppressionStore.getState().setRuntimeStatus(status, message, engine);
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
        stream,
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
        redemptionFrames: 8,
        frameSamples: 1536,
        preSpeechPadFrames: 4,
        minSpeechFrames: 4,
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
    this.stopCpuWatchdog();

    if (this.volumeAnimationFrame !== null) {
      cancelAnimationFrame(this.volumeAnimationFrame);
      this.volumeAnimationFrame = null;
    }

    if (this.micVAD) {
      await this.micVAD.destroy();
      this.micVAD = null;
    }

    miscordNoiseSuppressor.destroy();

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
      this.destinationNode,
    ];
    nodes.forEach((node) => {
      try {
        node?.disconnect();
      } catch {
        // A node can already be disconnected after an AudioWorklet failure.
      }
    });

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
