import type { MicVAD } from '@ricky0123/vad-web';
import {
  type NoiseSuppressionEngine,
  type NoiseSuppressionRuntimeStatus,
  useNoiseSuppressionStore,
} from '../store/noiseSuppressionStore';
import {
  getNoiseSuppressionFallbackChain,
  isNoiseSuppressionFallbackCurrent,
  resolveBrowserAutoGainControl,
} from './audioCapturePolicy';
import { AudioProcessingServiceBase } from './audioProcessingServiceBase';
import {
  type AudioProcessingConfig,
  type AudioProcessingDiagnostics,
  type AudioProcessingServiceOptions,
} from './audioProcessingTypes';
import { createVad } from './audioProcessingVad';
import { SingleFlight } from './singleFlight';

export type { NoiseSuppressionEngine } from '../store/noiseSuppressionStore';
export type {
  AudioProcessingConfig,
  AudioProcessingDiagnostics,
  AudioProcessingServiceOptions,
} from './audioProcessingTypes';

export class AudioProcessingService extends AudioProcessingServiceBase {
  private micVAD: MicVAD | null = null;
  private vadGeneration = 0;
  private readonly fallbackFlight = new SingleFlight();
  private captureConstraintQueue: Promise<void> = Promise.resolve();

  constructor(options: AudioProcessingServiceOptions = {}) {
    super(options);
  }

  protected async activateBrowserSuppression(
    fallback: boolean,
    message = 'Используется встроенная обработка WebRTC.',
    generation = this.pipelineGeneration,
    token = this.transitionGeneration,
  ): Promise<void> {
    const expectedEngine = fallback ? null : 'browser';
    if (!this.isTransitionCurrent(token, expectedEngine, generation)) return;
    this.destroyNeuralEnginesForTransition();
    await this.applyCaptureConstraints(true, 'browser');
    if (!this.isTransitionCurrent(token, expectedEngine, generation)) return;
    this.crossfadeToAI(false);
    this.activeEngine = 'browser';
    this.applyVoiceConditioning();
    this.setRuntimeStatus(fallback ? 'fallback' : 'active', message, 'browser');
  }

  protected async handleAIFailure(message: string): Promise<void> {
    if (!this.config.noiseSuppression) return;
    const key = `${this.pipelineGeneration}:${this.transitionGeneration}`;
    await this.fallbackFlight.run(() => this.runAIFallback(message), key);
  }

  private async runAIFallback(message: string): Promise<void> {
    const generation = this.pipelineGeneration;
    const transition = this.transitionGeneration;
    const failedEngine = this.activeEngine ?? this.config.noiseSuppressionEngine;
    if (!this.isFallbackCurrent(generation, transition)) return;

    if (getNoiseSuppressionFallbackChain(failedEngine).includes('miscord-ai')) {
      const started = await this.startMiscordAI(
        generation,
        transition,
        null,
        'fallback',
        `${message} Используется резервный Miscord AI.`,
      );
      if (started || !this.isFallbackCurrent(generation, transition)) return;
    }

    await this.activateBrowserSuppression(
      true,
      `${message} Используется встроенная обработка WebRTC.`,
      generation,
      transition,
    );
  }

  private isFallbackCurrent(generation: number, transition: number): boolean {
    return isNoiseSuppressionFallbackCurrent(
      this.config.noiseSuppression,
      generation,
      this.pipelineGeneration,
      transition,
      this.transitionGeneration,
    );
  }

  async setNoiseSuppression(
    enabled: boolean,
    engine: NoiseSuppressionEngine = this.config.noiseSuppressionEngine,
  ): Promise<void> {
    const generation = this.pipelineGeneration;
    const token = ++this.transitionGeneration;
    this.config.noiseSuppression = enabled;
    this.config.noiseSuppressionEngine = engine;
    if (!this.audioContext || !this.sourceNode) {
      this.setRuntimeStatus('idle', null, null);
      return;
    }

    if (!enabled) {
      this.destroyNeuralEnginesForTransition();
      await this.applyCaptureConstraints(false, engine);
      if (
        !this.isOperationCurrent(generation, token) ||
        this.config.noiseSuppression
      ) return;
      this.crossfadeToAI(false);
      this.activeEngine = null;
      this.applyVoiceConditioning();
      this.setRuntimeStatus('idle', 'Шумоподавление выключено.', null);
      return;
    }

    if (engine !== 'browser') {
      await this.activateSelectedNeuralEngine(token);
      return;
    }
    await this.activateBrowserSuppression(false, undefined, generation, token);
  }

  protected async applyCaptureConstraints(
    enabled: boolean,
    engine: NoiseSuppressionEngine,
  ): Promise<void> {
    const track = this.sourceNode?.mediaStream.getAudioTracks()[0];
    if (!track) return;
    const echoCancellation = this.config.echoCancellation;
    const autoGainControl = this.config.autoGainControl;
    const operation = this.captureConstraintQueue.then(() =>
      this.applyCaptureConstraintsToTrack(
        track,
        enabled,
        engine,
        echoCancellation,
        autoGainControl,
      ),
    );
    this.captureConstraintQueue = operation.catch(() => undefined);
    await operation;
  }

  private async applyCaptureConstraintsToTrack(
    track: MediaStreamTrack,
    enabled: boolean,
    engine: NoiseSuppressionEngine,
    echoCancellation: boolean,
    autoGainControl: boolean,
  ): Promise<void> {
    const supported = navigator.mediaDevices.getSupportedConstraints();
    const unsupported = [
      !supported.echoCancellation ? 'echoCancellation' : null,
      !supported.noiseSuppression ? 'noiseSuppression' : null,
      !supported.autoGainControl ? 'autoGainControl' : null,
    ].filter((value): value is string => value !== null);

    try {
      await track.applyConstraints({
        echoCancellation: supported.echoCancellation ? echoCancellation : undefined,
        noiseSuppression: supported.noiseSuppression ? enabled && engine === 'browser' : undefined,
        autoGainControl: supported.autoGainControl
          ? resolveBrowserAutoGainControl(autoGainControl, engine, enabled)
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

  protected crossfadeToAI(useAI: boolean, durationSeconds = 0.035): void {
    if (!this.audioContext || !this.dryGainNode || !this.wetGainNode) return;
    const now = this.audioContext.currentTime;
    const end = now + durationSeconds;
    const targets = [
      [this.dryGainNode.gain, useAI ? 0 : 1],
      [this.wetGainNode.gain, useAI ? 1 : 0],
    ] as const;
    for (const [gain, target] of targets) {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      if (durationSeconds > 0) gain.linearRampToValueAtTime(target, end);
      else gain.setValueAtTime(target, now);
    }
  }

  protected setRuntimeStatus(
    status: NoiseSuppressionRuntimeStatus,
    message: string | null,
    engine: NoiseSuppressionEngine | null,
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      status,
      message,
      configuredEngine: this.config.noiseSuppression ? this.config.noiseSuppressionEngine : null,
      activeEngine: engine,
      ...(engine !== 'deepfilternet3'
        ? {
            lsnr: null,
            wetRms: null,
            dryRms: null,
            rtf: null,
            overloadRatio: null,
            glitchSamples: null,
            droppedSamples: null,
          }
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
    const normalized = Math.max(0, Math.min(100, sensitivity)) / 100;
    this.config.speechProbabilityThreshold = 0.1 + 0.8 * normalized;
    if (this.micVAD && this.destinationNode) {
      void this.reinitializeVAD(this.destinationNode.stream);
    }
  }

  private async reinitializeVAD(stream: MediaStream): Promise<void> {
    const pipelineGeneration = this.pipelineGeneration;
    const lifecycleGeneration = this.lifecycleGeneration;
    const vadGeneration = ++this.vadGeneration;
    const previousVad = this.micVAD;
    this.micVAD = null;
    await this.disposeVad(previousVad);
    if (!this.isVadRequestCurrent(
      vadGeneration,
      pipelineGeneration,
      lifecycleGeneration,
    )) return;
    await this.createVAD(
      stream,
      vadGeneration,
      pipelineGeneration,
      lifecycleGeneration,
    );
  }

  protected async initializeVAD(
    stream: MediaStream,
    pipelineGeneration = this.pipelineGeneration,
    lifecycleGeneration = this.lifecycleGeneration,
  ): Promise<void> {
    const vadGeneration = ++this.vadGeneration;
    const previousVad = this.micVAD;
    this.micVAD = null;
    await this.disposeVad(previousVad);
    if (!this.isVadRequestCurrent(
      vadGeneration,
      pipelineGeneration,
      lifecycleGeneration,
    )) return;
    await this.createVAD(
      stream,
      vadGeneration,
      pipelineGeneration,
      lifecycleGeneration,
    );
  }

  private async createVAD(
    stream: MediaStream,
    vadGeneration: number,
    pipelineGeneration: number,
    lifecycleGeneration: number,
  ): Promise<void> {
    let createdVad: MicVAD | null = null;
    const isActive = () =>
      createdVad !== null &&
      this.micVAD === createdVad &&
      this.isVadRequestCurrent(
        vadGeneration,
        pipelineGeneration,
        lifecycleGeneration,
      );
    try {
      createdVad = await createVad(stream, this.config.speechProbabilityThreshold, {
        onSpeechStart: () => {
          if (!isActive()) return;
          this.speaking = true;
          this.onSpeechStart?.();
        },
        onSpeechEnd: () => {
          if (!isActive()) return;
          this.speaking = false;
          this.onSpeechEnd?.();
        },
        onMisfire: () => {
          if (!isActive()) return;
          this.speaking = false;
          this.onSpeechEnd?.();
        },
      });
      if (!this.isVadRequestCurrent(
        vadGeneration,
        pipelineGeneration,
        lifecycleGeneration,
      )) {
        await this.disposeVad(createdVad);
        return;
      }
      this.micVAD = createdVad;
    } catch (error) {
      if (!this.isVadRequestCurrent(
        vadGeneration,
        pipelineGeneration,
        lifecycleGeneration,
      )) return;
      console.error('[Audio] Failed to initialize VAD:', error);
    }
  }

  private async destroyVAD(): Promise<void> {
    this.vadGeneration += 1;
    const vad = this.micVAD;
    this.micVAD = null;
    await this.disposeVad(vad);
  }

  private isVadRequestCurrent(
    vadGeneration: number,
    pipelineGeneration: number,
    lifecycleGeneration: number,
  ): boolean {
    return vadGeneration === this.vadGeneration &&
      pipelineGeneration === this.pipelineGeneration &&
      lifecycleGeneration === this.lifecycleGeneration;
  }

  private async disposeVad(vad: MicVAD | null): Promise<void> {
    try {
      await vad?.destroy();
    } catch (error) {
      console.warn('[Audio] Failed to destroy VAD:', error);
    }
  }

  analyzeVolume(stream: MediaStream): void {
    if (!this.audioContext) return;
    if (this.volumeAnimationFrame !== null) cancelAnimationFrame(this.volumeAnimationFrame);
    this.analyserSource?.disconnect();
    this.analyser?.disconnect();
    const analysisStream = this.destinationNode?.stream ?? stream;
    this.analyser = this.audioContext.createAnalyser();
    this.analyserSource = this.audioContext.createMediaStreamSource(analysisStream);
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    this.analyserSource.connect(this.analyser);

    const data = new Uint8Array(this.analyser.frequencyBinCount);
    let speechFrames = 0;
    let silenceFrames = 0;
    const checkVolume = () => {
      if (!this.analyser || this.audioContext?.state === 'closed') return;
      this.analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (const value of data) {
        const sample = (value - 128) / 128;
        sumSquares += sample * sample;
      }
      this.currentVolume = Math.min(100, Math.sqrt(sumSquares / data.length) * 220);
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

  async refreshSpeakingDetection(): Promise<void> {
    if (this.config.vadEnabled && this.destinationNode?.stream) {
      await this.reinitializeVAD(this.destinationNode.stream);
    }
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
    const previousNoiseSuppression = this.config.noiseSuppression;
    const previousNoiseSuppressionEngine = this.config.noiseSuppressionEngine;
    this.config = { ...this.config, ...config };
    if (config.voiceConditioning !== undefined) this.applyVoiceConditioning();
    const noiseSuppressionChanged =
      this.config.noiseSuppression !== previousNoiseSuppression ||
      this.config.noiseSuppressionEngine !== previousNoiseSuppressionEngine;
    if (noiseSuppressionChanged) {
      void this.setNoiseSuppression(this.config.noiseSuppression, this.config.noiseSuppressionEngine);
      return;
    }
    if (config.autoGainControl !== undefined) this.applyNeuralAutoGain();
    if (config.echoCancellation !== undefined || config.autoGainControl !== undefined) {
      void this.applyCaptureConstraints(
        this.config.noiseSuppression,
        this.activeEngine ?? this.config.noiseSuppressionEngine,
      );
    }
  }

  async destroy(
    resetRuntimeStatus = true,
    lifecycleRequest?: number,
  ): Promise<void> {
    const lifecycle = lifecycleRequest ?? ++this.lifecycleGeneration;
    const generation = ++this.pipelineGeneration;
    const token = ++this.transitionGeneration;
    const context = this.audioContext;
    const nodes: Array<AudioNode | null> = [
      this.analyserSource, this.analyser, this.sourceNode, this.inputGainNode,
      this.highPassNode, this.dryGainNode, this.wetGainNode, this.compressorNode,
      this.makeupGainNode, this.muteGainNode, this.aiNode,
      this.deepFilterNet3Node, this.destinationNode,
    ];
    const frame = this.volumeAnimationFrame;

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
    this.deepFilterNet3Node = null;
    this.analyser = null;
    this.analyserSource = null;
    this.volumeAnimationFrame = null;
    this.currentVolume = 0;
    this.speaking = false;
    this.activeEngine = null;

    if (frame !== null) cancelAnimationFrame(frame);
    const vadCleanup = this.destroyVAD();
    this.miscordNoiseSuppressor.destroy();
    this.deepFilterNet3NoiseSuppressor.destroy();
    for (const node of nodes) {
      try {
        node?.disconnect();
      } catch {
        // A failed AudioWorklet may already be disconnected.
      }
    }
    const contextCleanup = context?.state !== 'closed'
      ? context?.close()
      : Promise.resolve();
    await Promise.allSettled([vadCleanup, contextCleanup]);
    if (
      resetRuntimeStatus &&
      lifecycle === this.lifecycleGeneration &&
      this.isOperationCurrent(generation, token)
    ) this.setRuntimeStatus('idle', null, null);
  }
}

export const audioProcessingService = new AudioProcessingService();
