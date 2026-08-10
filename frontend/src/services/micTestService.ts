import { AudioProcessingService } from './audioProcessingService';
import type { NoiseSuppressionRuntimeStatus } from '../store/noiseSuppressionStore';
import {
  captureAudioStream,
  type VoiceProcessingSettings,
} from './voiceSettings';
import { groupVoiceController } from './voice/GroupVoiceController';

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
  private operation: Promise<void> = Promise.resolve();
  private rawStream: MediaStream | null = null;
  private processedStream: MediaStream | null = null;
  private processor: AudioProcessingService | null = null;
  private monitorContext: AudioContext | null = null;
  private monitorElement: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
  private frameId: number | null = null;
  private usingCallStream = false;

  start(options: MicTestOptions): Promise<void> {
    const generation = ++this.generation;
    const operation = this.operation.then(async () => {
      await this.releaseResources();
      if (generation !== this.generation) return;
      await this.startCurrent(generation, options);
    });
    this.operation = operation.catch(() => undefined);
    return operation;
  }

  private async startCurrent(
    generation: number,
    options: MicTestOptions,
  ): Promise<void> {
    try {
      const callStream = await groupVoiceController.beginMicrophoneMonitor();
      if (generation !== this.generation) {
        await groupVoiceController.endMicrophoneMonitor();
        return;
      }
      if (callStream) {
        this.usingCallStream = true;
        this.processedStream = callStream;
        const diagnostics = groupVoiceController.getDiagnostics();
        options.onRuntimeStatus?.(
          diagnostics.status,
          diagnostics.message,
          diagnostics.activeEngine,
        );
        await this.attachMonitor(callStream, options);
        return;
      }

      const processor = new AudioProcessingService({
        publishRuntimeStatus: false,
        onRuntimeStatus: options.onRuntimeStatus,
      });
      this.processor = processor;
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
      await this.attachMonitor(processedStream, options);
    } catch (error) {
      await this.releaseResources();
      throw error;
    }
  }

  private async attachMonitor(
    processedStream: MediaStream,
    options: MicTestOptions,
  ): Promise<void> {
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
  }

  stop(): void {
    this.generation += 1;
    const operation = this.operation.then(() => this.releaseResources());
    this.operation = operation.catch(() => undefined);
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

    if (this.usingCallStream) {
      this.usingCallStream = false;
      await groupVoiceController.endMicrophoneMonitor();
    }

    const processor = this.processor;
    this.processor = null;
    if (processor) await processor.destroy(false);

    const context = this.monitorContext;
    this.monitorContext = null;
    if (context && context.state !== 'closed') await context.close();
  }
}
