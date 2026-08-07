import { MiscordNoiseSuppressor } from './miscordNoiseSuppressor';
import { DeepFilterNet3NoiseSuppressor } from './deepFilterNet3NoiseSuppressor';
import type { NoiseSuppressionEngine } from '../store/noiseSuppressionStore';

export type MicTestNoiseMode =
  | { kind: 'off' }
  | { kind: 'browser' }
  | { kind: 'miscord-ai' }
  | { kind: 'deepfilternet3' };

export type MicTestOptions = {
  inputDeviceId?: string;
  outputDeviceId?: string;
  noiseMode: MicTestNoiseMode;
  inputVolume: number;
  outputVolume: number;
  onLevel?: (level: number) => void;
  onInputEnded?: () => void;
};

type SinkAudioContext = AudioContext & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

/** Режим из store — читать getState() непосредственно перед стартом. */
export function micTestNoiseModeFromStore(
  enabled: boolean,
  engine: NoiseSuppressionEngine
): MicTestNoiseMode {
  if (!enabled) return { kind: 'off' };
  if (engine === 'browser') return { kind: 'browser' };
  if (engine === 'deepfilternet3') return { kind: 'deepfilternet3' };
  return { kind: 'miscord-ai' };
}

/**
 * Проверка микрофона с самопрослушиванием через Web Audio.
 * Каждый режим шумодава — отдельный getUserMedia + отдельный граф.
 */
export class MicTestSession {
  private generation = 0;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private suppressor: MiscordNoiseSuppressor | DeepFilterNet3NoiseSuppressor | null = null;
  private monitorGain: GainNode | null = null;
  private rafId: number | null = null;
  private endedHandler: (() => void) | null = null;
  private activeMode: MicTestNoiseMode['kind'] | null = null;

  getActiveMode(): MicTestNoiseMode['kind'] | null {
    return this.activeMode;
  }

  setOutputVolume(percent: number): void {
    if (!this.monitorGain) return;
    this.monitorGain.gain.value = Math.min(1, Math.max(0, (percent / 100) * 0.9));
  }

  async start(options: MicTestOptions): Promise<void> {
    const generation = ++this.generation;
    this.stopResources();

    const mode = options.noiseMode;
    this.activeMode = mode.kind;

    const useBrowserNs = mode.kind === 'browser';
    const useAiPipeline = mode.kind === 'miscord-ai' || mode.kind === 'deepfilternet3';

    const stream = await this.openMicStream({
      inputDeviceId: options.inputDeviceId,
      useBrowserNs,
      useAiPipeline,
    });

    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (track) {
      this.endedHandler = () => {
        if (generation !== this.generation) return;
        options.onInputEnded?.();
      };
      track.addEventListener('ended', this.endedHandler);
    }

    let audioContext = await this.createAudioContext(useAiPipeline, stream);
    if (generation !== this.generation) {
      this.stopResources();
      return;
    }

    this.audioContext = audioContext;
    await this.applyOutputDevice(audioContext, options.outputDeviceId);

    const source = audioContext.createMediaStreamSource(stream);
    const inputGain = audioContext.createGain();
    inputGain.gain.value = Math.min(1.8, Math.max(0, (options.inputVolume / 100) * 1.25));

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.12;

    const monitorGain = audioContext.createGain();
    monitorGain.gain.value = Math.min(1, Math.max(0, (options.outputVolume / 100) * 0.9));
    this.monitorGain = monitorGain;

    if (mode.kind === 'miscord-ai' || mode.kind === 'deepfilternet3') {
      await this.connectAiChain({
        generation,
        mode: mode.kind,
        audioContext,
        source,
        inputGain,
        analyser,
        monitorGain,
      });
    } else {
      source.connect(inputGain);
      inputGain.connect(analyser);
      analyser.connect(monitorGain);
      monitorGain.connect(audioContext.destination);
    }

    if (generation !== this.generation) {
      this.stopResources();
      return;
    }

    this.startMeterLoop(generation, analyser, options.onLevel);
  }

  private async createAudioContext(
    useAiPipeline: boolean,
    stream: MediaStream
  ): Promise<AudioContext> {
    const trackRate = stream.getAudioTracks()[0]?.getSettings()?.sampleRate;
    const preferredRate = useAiPipeline ? 48000 : trackRate || undefined;

    let ctx = new AudioContext({
      ...(preferredRate ? { sampleRate: preferredRate } : {}),
      latencyHint: 'interactive',
    });

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (useAiPipeline && ctx.sampleRate !== 48000) {
      await ctx.close();
      ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      if (ctx.state === 'suspended') await ctx.resume();
    }

    return ctx;
  }

  private async connectAiChain(params: {
    generation: number;
    mode: 'miscord-ai' | 'deepfilternet3';
    audioContext: AudioContext;
    source: MediaStreamAudioSourceNode;
    inputGain: GainNode;
    analyser: AnalyserNode;
    monitorGain: GainNode;
  }): Promise<void> {
    const { generation, mode, audioContext, source, inputGain, analyser, monitorGain } = params;

    const connectDry = () => {
      source.connect(inputGain);
      inputGain.connect(analyser);
      analyser.connect(monitorGain);
      monitorGain.connect(audioContext.destination);
    };

    if (audioContext.sampleRate !== 48000) {
      console.warn(`[MicTest] AI недоступен: AudioContext ${audioContext.sampleRate} Гц вместо 48000`);
      connectDry();
      return;
    }

    const highPass = audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 72;
    highPass.Q.value = 0.72;

    try {
      if (mode === 'miscord-ai') {
        const suppressor = new MiscordNoiseSuppressor();
        const node = await suppressor.createNode(audioContext);
        if (generation !== this.generation) {
          suppressor.destroy();
          return;
        }
        source.connect(inputGain);
        inputGain.connect(highPass);
        highPass.connect(node);
        node.connect(analyser);
        analyser.connect(monitorGain);
        monitorGain.connect(audioContext.destination);
        this.suppressor = suppressor;
        await suppressor.warmUp();
      } else {
        const suppressor = new DeepFilterNet3NoiseSuppressor();
        const node = await suppressor.createNode(audioContext);
        if (generation !== this.generation) {
          suppressor.destroy();
          return;
        }
        source.connect(inputGain);
        inputGain.connect(highPass);
        highPass.connect(node);
        node.connect(analyser);
        analyser.connect(monitorGain);
        monitorGain.connect(audioContext.destination);
        this.suppressor = suppressor;
        await suppressor.warmUp();
      }
    } catch (error) {
      console.warn(`[MicTest] ${mode} не запустился, проверка без AI:`, error);
      try {
        this.suppressor?.destroy();
      } catch {
        // ignore
      }
      this.suppressor = null;
      connectDry();
    }
  }

  private startMeterLoop(
    generation: number,
    analyser: AnalyserNode,
    onLevel?: (level: number) => void
  ): void {
    const dataArray = new Float32Array(analyser.fftSize / 2);
    const tick = () => {
      if (generation !== this.generation) return;
      analyser.getFloatTimeDomainData(dataArray);
      let max = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const abs = Math.abs(dataArray[i]);
        if (abs > max) max = abs;
      }
      onLevel?.(Math.min(100, (max / 0.4) * 100));
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.generation += 1;
    this.activeMode = null;
    this.stopResources();
  }

  private async openMicStream(params: {
    inputDeviceId?: string;
    useBrowserNs: boolean;
    useAiPipeline: boolean;
  }): Promise<MediaStream> {
    const base: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: params.useBrowserNs,
      // AGC только для browser/AI — в режиме «выкл» слышен реальный уровень шума
      autoGainControl: params.useBrowserNs || params.useAiPipeline,
      channelCount: 1,
      ...(params.useAiPipeline ? { sampleRate: 48000 } : {}),
    };

    const open = (deviceId?: string) =>
      navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { ...base, deviceId: { ideal: deviceId } } : base,
      });

    const deviceId = params.inputDeviceId;
    if (deviceId) {
      try {
        return await open(deviceId);
      } catch {
        // устройство недоступно
      }
    }

    return open();
  }

  private async applyOutputDevice(audioContext: AudioContext, outputDeviceId?: string): Promise<void> {
    if (!outputDeviceId || outputDeviceId === 'default') return;
    const ctx = audioContext as SinkAudioContext;
    if (typeof ctx.setSinkId !== 'function') return;
    try {
      await ctx.setSinkId(outputDeviceId);
    } catch (error) {
      console.warn('[MicTest] Не удалось выбрать наушники/динамик:', error);
    }
  }

  private stopResources(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    const track = this.stream?.getAudioTracks()[0];
    if (track && this.endedHandler) {
      track.removeEventListener('ended', this.endedHandler);
    }
    this.endedHandler = null;

    try {
      this.suppressor?.destroy();
    } catch {
      // ignore
    }
    this.suppressor = null;
    this.monitorGain = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
    }
    this.audioContext = null;
  }
}
