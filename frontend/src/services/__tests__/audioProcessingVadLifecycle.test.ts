import type { MicVAD } from '@ricky0123/vad-web';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createVad: vi.fn(),
  callbacks: [] as Array<{
    onSpeechStart: () => void;
    onSpeechEnd: () => void;
    onMisfire: () => void;
  }>,
}));

vi.mock('../audioProcessingVad', () => ({
  createVad: mocks.createVad,
  preloadVadRuntime: vi.fn(async () => undefined),
}));

import { AudioProcessingService } from '../audioProcessingService';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const fakeVad = (): MicVAD => ({
  destroy: vi.fn(async () => undefined),
}) as unknown as MicVAD;

class VadHarness extends AudioProcessingService {
  startVad(stream: MediaStream): Promise<void> {
    return this.initializeVAD(stream);
  }

  currentVad(): MicVAD | null {
    return (this as unknown as { micVAD: MicVAD | null }).micVAD;
  }
}

describe('audio processing VAD lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callbacks.length = 0;
  });

  it('destroys a stale reverse-resolution VAD and ignores its callbacks', async () => {
    const firstGate = deferred<MicVAD>();
    const secondGate = deferred<MicVAD>();
    const firstVad = fakeVad();
    const secondVad = fakeVad();
    mocks.createVad
      .mockImplementationOnce((
        _stream: MediaStream,
        _threshold: number,
        callbacks: typeof mocks.callbacks[number],
      ) => {
        mocks.callbacks.push(callbacks);
        return firstGate.promise;
      })
      .mockImplementationOnce((
        _stream: MediaStream,
        _threshold: number,
        callbacks: typeof mocks.callbacks[number],
      ) => {
        mocks.callbacks.push(callbacks);
        return secondGate.promise;
      });
    const service = new VadHarness({ publishRuntimeStatus: false });
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    service.setOnSpeechStart(onSpeechStart);
    service.setOnSpeechEnd(onSpeechEnd);

    const firstStart = service.startVad({} as MediaStream);
    await vi.waitFor(() => expect(mocks.createVad).toHaveBeenCalledTimes(1));
    const secondStart = service.startVad({} as MediaStream);
    await vi.waitFor(() => expect(mocks.createVad).toHaveBeenCalledTimes(2));
    secondGate.resolve(secondVad);
    await secondStart;
    firstGate.resolve(firstVad);
    await firstStart;

    expect(service.currentVad()).toBe(secondVad);
    expect(firstVad.destroy).toHaveBeenCalledTimes(1);
    expect(secondVad.destroy).not.toHaveBeenCalled();
    mocks.callbacks[0].onSpeechStart();
    mocks.callbacks[0].onSpeechEnd();
    mocks.callbacks[0].onMisfire();
    expect(onSpeechStart).not.toHaveBeenCalled();
    expect(onSpeechEnd).not.toHaveBeenCalled();

    mocks.callbacks[1].onSpeechStart();
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    mocks.callbacks[1].onMisfire();
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
    expect(service.isSpeaking()).toBe(false);
  });
});
