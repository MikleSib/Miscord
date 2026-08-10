import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  attachScreenMedia,
  captureGroupVoiceScreen,
  GroupVoiceScreenLifecycle,
} from '../groupVoiceScreen';

describe('group voice screen media', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the video element muted so screen audio has a single playback path', () => {
    const video = {
      autoplay: false,
      playsInline: false,
      muted: false,
      defaultMuted: false,
      srcObject: null,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => video),
    });
    vi.stubGlobal('MediaStream', class {
      constructor(readonly tracks: MediaStreamTrack[]) {}
    });
    const videoTrack = { kind: 'video' } as MediaStreamTrack;
    const audioTrack = { kind: 'audio' } as MediaStreamTrack;
    const stream = { getTracks: () => [videoTrack, audioTrack] } as unknown as MediaStream;

    attachScreenMedia(new Map(), 7, stream);

    expect(video.muted).toBe(true);
    expect(video.defaultMuted).toBe(true);
    expect((video.srcObject as MediaStream & { tracks: MediaStreamTrack[] }).tracks)
      .toEqual([videoTrack, audioTrack]);
  });

  it('stops every captured track when the picker returns no video', async () => {
    const audioTrack = { kind: 'audio', stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = {
      getVideoTracks: () => [],
      getTracks: () => [audioTrack],
    } as unknown as MediaStream;
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
    });

    await expect(captureGroupVoiceScreen({})).rejects.toThrow('видеодорожку');
    expect(audioTrack.stop).toHaveBeenCalledOnce();
  });

  it('rolls back when capture ends during a slow SFU start', async () => {
    let finishStart!: () => void;
    const startGate = new Promise<void>((resolve) => { finishStart = resolve; });
    const videoTrack = {
      kind: 'video', readyState: 'live', contentHint: '', stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const stream = {
      getVideoTracks: () => [videoTrack], getTracks: () => [videoTrack],
    } as unknown as MediaStream;
    const transport = {
      startScreenShare: vi.fn(() => startGate),
      stopScreenShare: vi.fn(async () => undefined),
    };
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
    });
    const lifecycle = new GroupVoiceScreenLifecycle();
    const starting = lifecycle.start({
      options: {}, transport: transport as never, isCurrent: () => true,
    });
    await vi.waitFor(() => expect(transport.startScreenShare).toHaveBeenCalledOnce());
    Object.defineProperty(videoTrack, 'readyState', { value: 'ended' });
    finishStart();

    await expect(starting).resolves.toEqual({ stream: null, cancelled: false });
    expect(transport.stopScreenShare).toHaveBeenCalledOnce();
    expect(videoTrack.stop).toHaveBeenCalledOnce();
  });
});
