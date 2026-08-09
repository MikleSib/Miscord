import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  requests: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  produced: [] as Array<{ options: Record<string, unknown>; producer: FakeProducer }>,
  handlers: new Map<string, (payload: any) => void>(),
}));

class FakeProducer {
  paused = false;
  closed = false;

  constructor(readonly id: string) {}

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  close(): void { this.closed = true; }
  async replaceTrack(): Promise<void> {}
}

class FakeTransport {
  readonly id: string;
  closed = false;

  constructor(readonly direction: 'send' | 'recv') {
    this.id = `${direction}-transport`;
  }

  on(): void {}

  async produce(options: Record<string, unknown>): Promise<FakeProducer> {
    const source = String((options.appData as { source?: string } | undefined)?.source ?? 'unknown');
    const producer = new FakeProducer(`${source}-${state.produced.length}`);
    state.produced.push({ options, producer });
    return producer;
  }

  close(): void { this.closed = true; }
}

vi.mock('mediasoup-client', () => ({
  Device: class {
    readonly rtpCapabilities = {};
    async load(): Promise<void> {}
    createSendTransport(): FakeTransport { return new FakeTransport('send'); }
    createRecvTransport(): FakeTransport { return new FakeTransport('recv'); }
  },
}));

vi.mock('../mediaRpcClient', () => ({
  MediaRpcClient: class {
    async connect(): Promise<Record<string, unknown>> {
      return { protocol_version: 1, router_rtp_capabilities: {}, producers: [] };
    }

    async request(type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
      state.requests.push({ type, payload });
      if (type === 'create_transport') {
        return {
          transport_id: `${payload.direction}-transport`,
          ice_parameters: {},
          ice_candidates: [],
          dtls_parameters: {},
        };
      }
      return {};
    }

    on(type: string, handler: (payload: any) => void): void { state.handlers.set(type, handler); }
    close(): void {}
  },
}));

import { SfuTransport } from '../sfuTransport';

function track(kind: 'audio' | 'video') {
  return {
    kind,
    addEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function screenStream(video: MediaStreamTrack, audio?: MediaStreamTrack): MediaStream {
  return {
    getVideoTracks: () => [video],
    getAudioTracks: () => audio ? [audio] : [],
    getTracks: () => audio ? [video, audio] : [video],
  } as unknown as MediaStream;
}

beforeEach(() => {
  state.requests.length = 0;
  state.produced.length = 0;
  state.handlers.clear();
});

describe('SfuTransport lifecycle', () => {
  it('uses one send and one receive transport and gates the microphone producer', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));

    expect(state.requests.filter((item) => item.type === 'create_transport').map((item) => item.payload.direction))
      .toEqual(['send', 'recv']);
    await transport.setMicrophoneMuted(true);
    expect(state.produced[0]?.producer.paused).toBe(true);
    expect(state.requests.at(-1)).toMatchObject({ type: 'pause_producer' });
    await transport.setMicrophoneMuted(false);
    expect(state.produced[0]?.producer.paused).toBe(false);
    expect(state.requests.at(-1)).toMatchObject({ type: 'resume_producer' });
    transport.close();
  });

  it('starts, stops and restarts simulcast screen video with optional audio', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));

    const firstVideo = track('video');
    await transport.startScreenShare(screenStream(firstVideo, track('audio')));
    expect(state.produced.map((item) => (item.options.appData as { source: string }).source))
      .toEqual(['microphone', 'screen-video', 'screen-audio']);
    expect((state.produced[1]?.options.encodings as unknown[]).length).toBe(3);
    expect(firstVideo.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function), { once: true });

    await transport.stopScreenShare();
    expect(state.requests.filter((item) => item.type === 'close_producer')).toHaveLength(2);
    expect(state.produced[1]?.producer.closed).toBe(true);
    expect(state.produced[2]?.producer.closed).toBe(true);

    await transport.startScreenShare(screenStream(track('video')));
    await transport.stopScreenShare();
    expect(state.requests.filter((item) => item.type === 'close_producer')).toHaveLength(3);
    transport.close();
  });

  it('consumes a screen producer that appears after the viewer subscribes', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    const consume = vi.spyOn(transport as any, 'consume').mockResolvedValue(undefined);

    await transport.ensureScreenShare(77);
    state.handlers.get('producer_available')?.({
      producer_id: 'late-screen',
      user_id: 77,
      source: 'screen-video',
      kind: 'video',
    });

    await vi.waitFor(() => expect(consume).toHaveBeenCalledWith(expect.objectContaining({
      producer_id: 'late-screen',
      user_id: 77,
    })));

    consume.mockClear();
    transport.clearScreenShareRequest(77);
    state.handlers.get('producer_available')?.({
      producer_id: 'restarted-screen',
      user_id: 77,
      source: 'screen-video',
      kind: 'video',
    });
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(consume).not.toHaveBeenCalled();
    transport.close();
  });
});
