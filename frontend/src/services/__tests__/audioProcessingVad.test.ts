import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('@ricky0123/vad-web', () => ({
  MicVAD: { new: mocks.create },
}));

import { createVad } from '../audioProcessingVad';

describe('audio processing VAD helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('destroys the VAD instance when start rejects before it can be returned', async () => {
    const startError = new Error('start failed');
    const vad = {
      start: vi.fn(async () => Promise.reject(startError)),
      destroy: vi.fn(async () => undefined),
    };
    mocks.create.mockResolvedValue(vad);

    await expect(createVad(
      {} as MediaStream,
      0.35,
      {
        onSpeechStart: vi.fn(),
        onSpeechEnd: vi.fn(),
        onMisfire: vi.fn(),
      },
    )).rejects.toBe(startError);

    expect(vad.destroy).toHaveBeenCalledTimes(1);
  });
});
