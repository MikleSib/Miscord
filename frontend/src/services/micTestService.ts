import { AudioProcessingService } from './audioProcessingService';
import type { NoiseSuppressionRuntimeStatus } from '../store/noiseSuppressionStore';
import {
  captureAudioStream,
  type VoiceProcessingSettings,
} from './voiceSettings';

export interface MicTestOptions {
  inputDeviceId?: string;
  outputDeviceId?: string;
  inputVolume: number;
  outputVolume: number;
  processing: VoiceProcessingSettings;
  onLevel: (level: number) => void;
  onRuntimeStatus?: (
    status: NoiseSuppressionRuntimeStatus,
    message: string | null,
    engine: string | null,
  ) => void;
}

export class MicTestSession {
  private generation = 0;
  private rawStream: MediaStream | null = null;
  private processedStream: MediaStream | null = null;
  private processor: AudioProcessingService | null = null;
  private monitorContext: AudioContext | null = null;
  private monitorElement: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
  private frameId: number | null = null;

  async start(options: MicTestOptions): Promise<void> {
    const generation = ++this.generation;
    await this.releaseResources();

    const processor = new AudioProcessingService({
      publishRuntimeStatus: false,
      onRuntimeStatus: options.onRuntimeStatus,
    });
    this.processor = processor;

    try {
      const rawStream = await captureAudioStream(
        options.processing,
        options.inputDeviceId,
      );
      if (generation !== this.generation) {
        rawStream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.rawStream = rawStream;

      const processedStream = await processor.initialize(rawStream, {
        vadEnabled: false,
        noiseSuppression: options.processing.noiseSuppression,
        echoCancellation: options.processing.echoCancellation,
        autoGainControl: options.processing.autoGainControl,
        voiceConditioning: options.processing.voiceConditioning,
        useAdvancedNoiseSuppression:
          options.processing.noiseSuppression &&
          options.processing.noiseSuppressionEngine !== 'browser',
        noiseSuppressionEngine:
          options.processing.noiseSuppressionEngine,
      });
      if (generation !== this.generation) {
        await processor.destroy(false);
        return;
      }

      this.processedStream = processedStream;
      processor.setInputVolume(options.inputVolume);

      const monitorContext = new AudioContext();
      this.monitorContext = monitorContext;
      if (monitorContext.state === 'suspended') {
        await monitorContext.resume();
      }

      const source = monitorContext.createMediaStreamSource(processedStream);
      const analyser = monitorContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.18;
      this.analyser = analyser;
      source.connect(analyser);

      const monitorElement = new Audio();
      this.monitorElement = monitorElement;
      monitorElement.autoplay = true;
      monitorElement.volume = Math.max(
        0,
        Math.min(1, options.outputVolume / 100),
      );
      monitorElement.srcObject = processedStream;

      if (
        options.outputDeviceId &&
        options.outputDeviceId !== 'default' &&
        'setSinkId' in monitorElement
      ) {
        await (
          monitorElement as HTMLAudioElement & {
            setSinkId: (deviceId: string) => Promise<void>;
          }
        ).setSinkId(options.outputDeviceId);
      }

      await monitorElement.play();
      this.startMeter(options.onLevel);
    } catch (error) {
      await this.releaseResources();
      throw error;
    }
  }

  stop(): void {
    this.generation += 1;
    void this.releaseResources();
  }

  private startMeter(onLevel: (level: number) => void): void {
    if (!this.analyser) return;
    const samples = new Float32Array(this.analyser.fftSize);

    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / samples.length);
      onLevel(Math.max(0, Math.min(1, rms * 5)));
      this.frameId = requestAnimationFrame(tick);
    };

    tick();
  }

  private async releaseResources(): Promise<void> {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.analyser = null;

    if (this.monitorElement) {
      this.monitorElement.pause();
      this.monitorElement.srcObject = null;
      this.monitorElement = null;
    }

    this.rawStream?.getTracks().forEach((track) => track.stop());
    this.rawStream = null;
    this.processedStream = null;

    const processor = this.processor;
    this.processor = null;
    if (processor) await processor.destroy(false);

    const context = this.monitorContext;
    this.monitorContext = null;
    if (context && context.state !== 'closed') await context.close();
  }
}
