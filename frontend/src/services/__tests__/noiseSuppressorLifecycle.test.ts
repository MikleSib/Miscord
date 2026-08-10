import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadRnnoise: vi.fn(),
  nodes: [] as Array<{
    destroy: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@sapphi-red/web-noise-suppressor', () => ({
  loadRnnoise: mocks.loadRnnoise,
  RnnoiseWorkletNode: class extends EventTarget {
    destroy = vi.fn();
    disconnect = vi.fn();

    constructor() {
      super();
      mocks.nodes.push(this);
    }
  },
}));

import {
  MiscordNoiseSuppressor,
  NoiseSuppressorInitializationCancelledError,
} from '../miscordNoiseSuppressor';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function context(moduleLoad: Promise<void>): AudioContext {
  return {
    sampleRate: 48000,
    audioWorklet: { addModule: vi.fn(() => moduleLoad) },
  } as unknown as AudioContext;
}

describe('MiscordNoiseSuppressor lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nodes.length = 0;
    mocks.loadRnnoise.mockResolvedValue(
      new Uint8Array([0x00, 0x61, 0x73, 0x6d]).buffer,
    );
    class SupportedAudioContext {}
    Object.defineProperty(SupportedAudioContext.prototype, 'audioWorklet', {
      configurable: true,
      value: {},
    });
    vi.stubGlobal('window', { setTimeout });
    vi.stubGlobal('AudioWorkletNode', class {});
    vi.stubGlobal('AudioContext', SupportedAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the newest node when two creates resolve in reverse order', async () => {
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    const suppressor = new MiscordNoiseSuppressor();
    const oldResult = suppressor.createNode(context(firstGate.promise)).catch(
      (error) => error,
    );
    const current = suppressor.createNode(context(secondGate.promise));

    secondGate.resolve();
    const currentNode = await current;
    firstGate.resolve();
    expect(await oldResult).toBeInstanceOf(
      NoiseSuppressorInitializationCancelledError,
    );
    expect(currentNode).toBe(mocks.nodes[0]);
    expect(mocks.nodes[0].destroy).not.toHaveBeenCalled();

    suppressor.destroy();
    expect(mocks.nodes[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale create rejection after a newer node is active', async () => {
    const staleGate = deferred<void>();
    const currentGate = deferred<void>();
    const suppressor = new MiscordNoiseSuppressor();
    const staleResult = suppressor.createNode(context(staleGate.promise)).catch(
      (error) => error,
    );
    const current = suppressor.createNode(context(currentGate.promise));

    currentGate.resolve();
    const currentNode = await current;
    staleGate.reject(new Error('stale module failure'));
    expect(await staleResult).toBeInstanceOf(
      NoiseSuppressorInitializationCancelledError,
    );
    expect(currentNode).toBe(mocks.nodes[0]);
    expect(mocks.nodes[0].destroy).not.toHaveBeenCalled();
  });
});
