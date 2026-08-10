import { describe, expect, it, vi } from 'vitest';
import type {
  NoiseSuppressionEngine,
  NoiseSuppressionRuntimeStatus,
} from '../../store/noiseSuppressionStore';
import { AudioProcessingService } from '../audioProcessingService';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class TransitionHarness extends AudioProcessingService {
  readonly statuses: Array<{
    status: NoiseSuppressionRuntimeStatus;
    engine: NoiseSuppressionEngine | null;
  }> = [];
  private constraintResults: Array<Promise<void>> = [];

  constructor() {
    super({ publishRuntimeStatus: false });
    this.installGraph();
  }

  installGraph(): void {
    this.audioContext = {
      currentTime: 0,
      state: 'running',
      close: vi.fn(async () => undefined),
    } as unknown as AudioContext;
    this.sourceNode = {} as MediaStreamAudioSourceNode;
    this.highPassNode = { connect: vi.fn() } as unknown as BiquadFilterNode;
    this.wetGainNode = { connect: vi.fn() } as unknown as GainNode;
  }

  installReplacementGraph(node: AudioNode): void {
    this.lifecycleGeneration += 1;
    this.audioContext = {
      currentTime: 0,
      state: 'running',
      close: vi.fn(async () => undefined),
    } as unknown as AudioContext;
    this.sourceNode = node as MediaStreamAudioSourceNode;
  }

  queueConstraint(result: Promise<void>): void {
    this.constraintResults.push(result);
  }

  fallbackAfterFailure(): Promise<void> {
    return this.handleAIFailure('primary neural processor failed');
  }

  injectMiscordSuppressor(suppressor: object): void {
    Object.defineProperty(this, 'miscordNoiseSuppressor', {
      configurable: true,
      value: suppressor,
    });
  }

  injectDeepFilterNetSuppressor(suppressor: object): void {
    Object.defineProperty(this, 'deepFilterNet3NoiseSuppressor', {
      configurable: true,
      value: suppressor,
    });
  }

  setPendingVad(vad: object): void {
    Object.defineProperty(this, 'micVAD', {
      configurable: true,
      value: vad,
      writable: true,
    });
  }

  protected override applyCaptureConstraints(): Promise<void> {
    return this.constraintResults.shift() ?? Promise.resolve();
  }

  protected override crossfadeToAI(): void {}

  protected override applyVoiceConditioning(): void {}

  protected override setRuntimeStatus(
    status: NoiseSuppressionRuntimeStatus,
    _message: string | null,
    engine: NoiseSuppressionEngine | null,
  ): void {
    this.statuses.push({ status, engine });
  }
}

describe('audio processing transition lifecycle', () => {
  it('does not let a stale browser transition overwrite a newer OFF', async () => {
    const browserGate = deferred();
    const offGate = deferred();
    const service = new TransitionHarness();
    service.queueConstraint(browserGate.promise);
    service.queueConstraint(offGate.promise);

    const browser = service.setNoiseSuppression(true, 'browser');
    const off = service.setNoiseSuppression(false, 'browser');
    offGate.resolve();
    await off;
    browserGate.resolve();
    await browser;

    expect(service.statuses).toEqual([{ status: 'idle', engine: null }]);
  });

  it('ignores a stale neural create rejection after browser becomes active', async () => {
    const createGate = deferred<AudioWorkletNode>();
    const suppressor = {
      createNode: vi.fn(() => createGate.promise),
      destroy: vi.fn(),
      destroyNode: vi.fn(),
      warmUp: vi.fn(async () => undefined),
      preload: vi.fn(async () => undefined),
    };
    const service = new TransitionHarness();
    service.injectMiscordSuppressor(suppressor);

    const neural = service.setNoiseSuppression(true, 'miscord-ai');
    await vi.waitFor(() => expect(suppressor.createNode).toHaveBeenCalled());
    const browser = service.setNoiseSuppression(true, 'browser');
    await browser;
    createGate.reject(new Error('stale create failed'));
    await neural;

    expect(service.statuses.at(-1)).toEqual({
      status: 'active',
      engine: 'browser',
    });
    expect(service.statuses.some(({ status }) => status === 'fallback')).toBe(false);
  });

  it('an old destroy never disconnects a graph installed while cleanup awaits', async () => {
    const vadGate = deferred();
    const oldNode = { disconnect: vi.fn() } as unknown as AudioNode;
    const newNode = { disconnect: vi.fn() } as unknown as AudioNode;
    const service = new TransitionHarness();
    service.installReplacementGraph(oldNode);
    service.setPendingVad({ destroy: vi.fn(() => vadGate.promise) });

    const oldDestroy = service.destroy();
    service.installReplacementGraph(newNode);
    vadGate.resolve();
    await oldDestroy;

    expect(oldNode.disconnect).toHaveBeenCalled();
    expect(newNode.disconnect).not.toHaveBeenCalled();
    expect(service.statuses).toEqual([]);
  });

  it('keeps the RNNoise processor error handler active after same-engine config updates', async () => {
    const node = Object.assign(new EventTarget(), {
      connect: vi.fn(),
      disconnect: vi.fn(),
      destroy: vi.fn(),
    }) as unknown as AudioWorkletNode;
    const suppressor = {
      createNode: vi.fn(async () => node),
      destroy: vi.fn(),
      destroyNode: vi.fn(),
      warmUp: vi.fn(async () => undefined),
      preload: vi.fn(async () => undefined),
    };
    const service = new TransitionHarness();
    service.injectMiscordSuppressor(suppressor);
    await service.setNoiseSuppression(true, 'miscord-ai');
    const failure = vi.spyOn(
      service as unknown as { handleAIFailure: (message: string) => Promise<void> },
      'handleAIFailure',
    ).mockResolvedValue();

    service.updateConfig({
      noiseSuppression: true,
      noiseSuppressionEngine: 'miscord-ai',
      echoCancellation: false,
      autoGainControl: false,
      voiceConditioning: false,
    });
    node.dispatchEvent(new Event('processorerror'));

    expect(suppressor.createNode).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledTimes(1);
  });

  it('continues to browser fallback when RNNoise fails during fallback warm-up', async () => {
    const warmUpGate = deferred();
    const node = Object.assign(new EventTarget(), {
      connect: vi.fn(),
      disconnect: vi.fn(),
      destroy: vi.fn(),
    }) as unknown as AudioWorkletNode;
    const suppressor = {
      createNode: vi.fn(async () => node),
      destroy: vi.fn(),
      destroyNode: vi.fn(),
      warmUp: vi.fn(() => warmUpGate.promise),
      preload: vi.fn(async () => undefined),
    };
    const service = new TransitionHarness();
    service.injectMiscordSuppressor(suppressor);

    const fallback = service.fallbackAfterFailure();
    await vi.waitFor(() => expect(suppressor.warmUp).toHaveBeenCalled());
    node.dispatchEvent(new Event('processorerror'));
    warmUpGate.resolve();
    await fallback;

    expect(suppressor.destroyNode).toHaveBeenCalledWith(node);
    expect(service.statuses.at(-1)).toEqual({
      status: 'fallback',
      engine: 'browser',
    });
  });

  it('keeps DeepFilterNet overload handling active after same-engine config updates', async () => {
    const node = Object.assign(new EventTarget(), {
      connect: vi.fn(),
      disconnect: vi.fn(),
    }) as unknown as AudioWorkletNode;
    let onRealtimeOverload: (() => void) | undefined;
    const suppressor = {
      createNode: vi.fn(async (
        _context: AudioContext,
        options: { onRealtimeOverload?: () => void },
      ) => {
        onRealtimeOverload = options.onRealtimeOverload;
        return node;
      }),
      destroy: vi.fn(),
      destroyNode: vi.fn(),
      warmUp: vi.fn(async () => undefined),
      preload: vi.fn(async () => undefined),
      setAutoGain: vi.fn(),
    };
    const service = new TransitionHarness();
    service.injectDeepFilterNetSuppressor(suppressor);
    await service.setNoiseSuppression(true, 'deepfilternet3');
    const failure = vi.spyOn(
      service as unknown as { handleAIFailure: (message: string) => Promise<void> },
      'handleAIFailure',
    ).mockResolvedValue();

    service.updateConfig({
      noiseSuppression: true,
      noiseSuppressionEngine: 'deepfilternet3',
      echoCancellation: false,
      autoGainControl: false,
      voiceConditioning: false,
    });
    onRealtimeOverload?.();

    expect(suppressor.createNode).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledTimes(1);
  });

  it('keeps auto gain outside DeepFilterNet3 without recreating the model', async () => {
    const node = Object.assign(new EventTarget(), {
      connect: vi.fn(),
      disconnect: vi.fn(),
    }) as unknown as AudioWorkletNode;
    let createOptions: Record<string, unknown> | undefined;
    const suppressor = {
      createNode: vi.fn(async (
        _context: AudioContext,
        options: Record<string, unknown>,
      ) => {
        createOptions = options;
        return node;
      }),
      destroy: vi.fn(),
      destroyNode: vi.fn(),
      warmUp: vi.fn(async () => undefined),
      preload: vi.fn(async () => undefined),
    };
    const service = new TransitionHarness();
    service.injectDeepFilterNetSuppressor(suppressor);
    await service.setNoiseSuppression(true, 'deepfilternet3');

    expect(createOptions).not.toHaveProperty('autoGain');

    service.updateConfig({ autoGainControl: false });

    expect(suppressor.createNode).toHaveBeenCalledTimes(1);
  });
});
