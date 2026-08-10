import { beforeEach, describe, expect, it, vi } from 'vitest';

type DeferredRpc = {
  type: string;
  resolve: () => void;
};

const state = vi.hoisted(() => ({
  requests: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  produced: [] as Array<{ options: Record<string, unknown>; producer: FakeProducer; trackEnabledAtProduce?: boolean }>,
  consumed: [] as FakeConsumer[],
  handlers: new Map<string, (payload: any) => void>(),
  rejectedSource: null as string | null,
  deferGateRpcs: false,
  deferConsumeRpcs: false,
  deferCloseProducerRpcs: false,
  deferredRpcs: [] as DeferredRpc[],
  serverProducerPaused: new Map<string, boolean>(),
  serverConsumerPaused: new Map<string, boolean>(),
}));

class FakeProducer {
  paused = false;
  closed = false;
  private currentTrack?: MediaStreamTrack;

  constructor(readonly id: string, track?: MediaStreamTrack) { this.currentTrack = track; }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  close(): void { this.closed = true; }
  async replaceTrack(options: { track: MediaStreamTrack }): Promise<void> {
    this.currentTrack?.stop();
    this.currentTrack = options.track;
  }
}

class FakeConsumer {
  readonly id: string;
  readonly producerId: string;
  readonly kind: 'audio' | 'video';
  readonly track: MediaStreamTrack;
  paused = true;
  closed = false;

  constructor(options: Record<string, any>) {
    this.id = String(options.id);
    this.producerId = String(options.producerId);
    this.kind = options.kind;
    this.track = track(this.kind);
  }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  close(): void { this.closed = true; }
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
    if (state.rejectedSource === source) throw new Error(`${source} rejected`);
    const producer = new FakeProducer(
      `${source}-${state.produced.length}`,
      options.track as MediaStreamTrack | undefined,
    );
    state.produced.push({
      options,
      producer,
      trackEnabledAtProduce: (options.track as MediaStreamTrack | undefined)?.enabled,
    });
    state.serverProducerPaused.set(producer.id, false);
    return producer;
  }

  async consume(options: Record<string, any>): Promise<FakeConsumer> {
    const consumer = new FakeConsumer(options);
    state.consumed.push(consumer);
    return consumer;
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
      if (type === 'consume') {
        if (state.deferConsumeRpcs) {
          await new Promise<void>((resolve) => state.deferredRpcs.push({ type, resolve }));
        }
        const consumerId = `consumer-${payload.producer_id}`;
        state.serverConsumerPaused.set(consumerId, true);
        return {
          consumer_id: consumerId,
          producer_id: payload.producer_id,
          kind: 'audio',
          rtp_parameters: {},
          source: 'microphone',
          user_id: 77,
        };
      }
      if (
        (state.deferGateRpcs
          && ['pause_producer', 'resume_producer', 'pause_consumer', 'resume_consumer'].includes(type))
        || (state.deferCloseProducerRpcs && type === 'close_producer')
      ) {
        await new Promise<void>((resolve) => state.deferredRpcs.push({ type, resolve }));
      }
      if (type === 'pause_producer' || type === 'resume_producer') {
        state.serverProducerPaused.set(String(payload.producer_id), type === 'pause_producer');
      }
      if (type === 'pause_consumer' || type === 'resume_consumer') {
        state.serverConsumerPaused.set(String(payload.consumer_id), type === 'pause_consumer');
      }
      return {};
    }

    on(type: string, handler: (payload: any) => void): void { state.handlers.set(type, handler); }
    close(): void {}
  },
}));

import { SfuTransport } from '../sfuTransport';

vi.stubGlobal('MediaStream', class {
  constructor(readonly tracks: MediaStreamTrack[]) {}
});

function track(kind: 'audio' | 'video') {
  const value = {
    kind,
    enabled: true,
    stop: vi.fn(),
    addEventListener: vi.fn(),
    clone: vi.fn(() => track(kind)),
  } as unknown as MediaStreamTrack;
  return value;
}

function screenStream(video: MediaStreamTrack, audio?: MediaStreamTrack): MediaStream {
  return {
    getVideoTracks: () => [video],
    getAudioTracks: () => audio ? [audio] : [],
    getTracks: () => audio ? [video, audio] : [video],
  } as unknown as MediaStream;
}

async function waitForDeferred(type: string): Promise<void> {
  await vi.waitFor(() => expect(state.deferredRpcs.some((item) => item.type === type)).toBe(true));
}

function releaseDeferred(type: string): void {
  const index = state.deferredRpcs.findIndex((item) => item.type === type);
  if (index < 0) throw new Error(`No deferred ${type} RPC`);
  const [deferred] = state.deferredRpcs.splice(index, 1);
  deferred!.resolve();
}

beforeEach(() => {
  state.requests.length = 0;
  state.produced.length = 0;
  state.consumed.length = 0;
  state.handlers.clear();
  state.rejectedSource = null;
  state.deferGateRpcs = false;
  state.deferConsumeRpcs = false;
  state.deferCloseProducerRpcs = false;
  state.deferredRpcs.length = 0;
  state.serverProducerPaused.clear();
  state.serverConsumerPaused.clear();
});

describe('SfuTransport lifecycle', () => {
  it('uses one send and one receive transport and gates the microphone producer', async () => {
    const transport = new SfuTransport();
    const microphoneTrack = track('audio');
    await transport.connect('ws://local/ws/media', 'ticket', microphoneTrack);

    expect(state.requests.filter((item) => item.type === 'create_transport').map((item) => item.payload.direction))
      .toEqual(['send', 'recv']);
    expect(microphoneTrack.contentHint).toBe('speech');
    expect(state.produced[0]?.options.encodings).toEqual([{ maxBitrate: 80_000 }]);
    expect(state.produced[0]?.options.codecOptions).toEqual({
      opusStereo: false,
      opusDtx: false,
      opusFec: true,
      opusMaxAverageBitrate: 80_000,
      opusPtime: 20,
    });
    await transport.setSpeaking(true);
    expect(state.requests.at(-1)).toEqual({
      type: 'set_speaking',
      payload: { producer_id: 'microphone-0', speaking: true },
    });
    await transport.setSpeaking(true);
    expect(state.requests.filter((item) => item.type === 'set_speaking')).toHaveLength(1);
    await transport.setMicrophoneMuted(true);
    expect(state.produced[0]?.producer.paused).toBe(true);
    expect(state.requests.at(-1)).toMatchObject({ type: 'pause_producer' });
    await transport.setMicrophoneMuted(false);
    expect(state.produced[0]?.producer.paused).toBe(false);
    expect(state.requests.at(-1)).toMatchObject({ type: 'resume_producer' });
    transport.close();
  });

  it('creates an initially gated microphone without disabling the shared monitor track', async () => {
    const transport = new SfuTransport();
    const sharedTrack = track('audio');
    await transport.connect('ws://local/ws/media', 'ticket', sharedTrack, true);

    const producerTrack = state.produced[0]?.options.track as MediaStreamTrack;
    expect(producerTrack).not.toBe(sharedTrack);
    expect(sharedTrack.enabled).toBe(true);
    expect(producerTrack.enabled).toBe(true);
    expect(state.produced[0]?.trackEnabledAtProduce).toBe(false);
    expect(state.produced[0]?.options).toMatchObject({
      disableTrackOnPause: false,
      zeroRtpOnPause: true,
    });
    expect(state.produced[0]?.producer.paused).toBe(true);
    expect(state.requests.at(-1)).toMatchObject({ type: 'pause_producer' });
    transport.close();
  });

  it('honors a mute requested while connect is still creating transports', async () => {
    const transport = new SfuTransport();
    const sharedTrack = track('audio');
    const connecting = transport.connect('ws://local/ws/media', 'ticket', sharedTrack, false);
    await transport.setMicrophoneMuted(true);
    await connecting;

    expect(state.produced[0]?.trackEnabledAtProduce).toBe(false);
    expect(state.produced[0]?.producer.paused).toBe(true);
    expect(state.serverProducerPaused.get('microphone-0')).toBe(true);
    expect(sharedTrack.enabled).toBe(true);
    transport.close();
  });

  it('replaces only producer clones so the raw DSP source remains live', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    const raw = track('audio');
    const processed = track('audio');

    await transport.replaceMicrophoneTrack(raw);
    const bridgeClone = (raw.clone as ReturnType<typeof vi.fn>).mock.results[0]?.value as MediaStreamTrack;
    await transport.replaceMicrophoneTrack(processed);

    expect(raw.stop).not.toHaveBeenCalled();
    expect(bridgeClone.stop).toHaveBeenCalledOnce();
    expect(processed.stop).not.toHaveBeenCalled();
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
    expect(state.produced[2]?.options.encodings).toEqual([{ maxBitrate: 160_000 }]);
    expect(state.produced[2]?.options.codecOptions).toEqual({
      opusStereo: true,
      opusDtx: false,
      opusFec: true,
      opusMaxAverageBitrate: 160_000,
      opusPtime: 20,
    });
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

  it('closes and detaches both screen producers before delayed server cleanup finishes', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    await transport.startScreenShare(screenStream(track('video'), track('audio')));
    const video = state.produced[1]!.producer;
    const audio = state.produced[2]!.producer;
    state.deferCloseProducerRpcs = true;

    const stopping = transport.stopScreenShare();

    expect(video.closed).toBe(true);
    expect(audio.closed).toBe(true);
    expect((transport as unknown as { screenVideo: FakeProducer | null }).screenVideo).toBeNull();
    expect((transport as unknown as { screenAudio: FakeProducer | null }).screenAudio).toBeNull();
    expect(state.deferredRpcs.filter((item) => item.type === 'close_producer')).toHaveLength(2);

    releaseDeferred('close_producer');
    releaseDeferred('close_producer');
    await stopping;
    transport.close();
  });

  it('rolls back screen video when the optional audio producer fails', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    state.rejectedSource = 'screen-audio';

    await expect(transport.startScreenShare(screenStream(track('video'), track('audio'))))
      .rejects.toThrow('screen-audio rejected');
    expect(state.produced[1]?.producer.closed).toBe(true);
    expect(state.requests.filter((item) => item.type === 'close_producer')).toContainEqual({
      type: 'close_producer',
      payload: { producer_id: 'screen-video-1' },
    });

    state.rejectedSource = null;
    await expect(transport.startScreenShare(screenStream(track('video')))).resolves.toBeUndefined();
    await transport.stopScreenShare();
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

  it('coalesces concurrent consume requests for the same producer', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    await transport.ensureScreenShare(77);
    state.deferConsumeRpcs = true;
    const descriptor = {
      producer_id: 'slow-screen', user_id: 77, source: 'screen-video', kind: 'video',
    };

    state.handlers.get('producer_available')?.(descriptor);
    await waitForDeferred('consume');
    const second = transport.ensureScreenShare(77);
    expect(state.requests.filter((item) => item.type === 'consume')).toHaveLength(1);
    releaseDeferred('consume');
    await second;
    await vi.waitFor(() => expect(state.consumed).toHaveLength(1));
    expect(state.requests.filter((item) => item.type === 'consume')).toHaveLength(1);
    transport.close();
  });

  it('keeps a late audio consumer paused while deafened and resumes it on undeafen', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    await transport.setDeafened(true);

    state.handlers.get('producer_available')?.({
      producer_id: 'late-microphone',
      user_id: 77,
      source: 'microphone',
      kind: 'audio',
    });

    await vi.waitFor(() => expect(state.consumed).toHaveLength(1));
    await vi.waitFor(() => expect(state.requests).toContainEqual({
      type: 'pause_consumer',
      payload: { consumer_id: 'consumer-late-microphone' },
    }));
    expect(state.consumed[0]!.paused).toBe(true);
    expect(state.requests).not.toContainEqual({
      type: 'resume_consumer',
      payload: { consumer_id: 'consumer-late-microphone' },
    });

    await transport.setDeafened(false);
    expect(state.consumed[0]!.paused).toBe(false);
    expect(state.requests.at(-1)).toEqual({
      type: 'resume_consumer',
      payload: { consumer_id: 'consumer-late-microphone' },
    });
    transport.close();
  });

  it('serializes delayed microphone mute then unmute with latest state winning', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    const producer = state.produced[0]!.producer;
    state.deferGateRpcs = true;

    const mute = transport.setMicrophoneMuted(true);
    await waitForDeferred('pause_producer');
    const unmute = transport.setMicrophoneMuted(false);

    expect(producer.paused).toBe(true);
    expect(state.deferredRpcs.map((item) => item.type)).toEqual(['pause_producer']);
    releaseDeferred('pause_producer');
    await waitForDeferred('resume_producer');
    expect(state.serverProducerPaused.get(producer.id)).toBe(true);
    expect(producer.paused).toBe(true);

    releaseDeferred('resume_producer');
    await Promise.all([mute, unmute]);
    expect(state.serverProducerPaused.get(producer.id)).toBe(false);
    expect(producer.paused).toBe(false);
    transport.close();
  });

  it('keeps privacy mute immediate while serializing delayed unmute then mute', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    const producer = state.produced[0]!.producer;
    await transport.setMicrophoneMuted(true);
    state.deferGateRpcs = true;

    const unmute = transport.setMicrophoneMuted(false);
    await waitForDeferred('resume_producer');
    const mute = transport.setMicrophoneMuted(true);

    expect(producer.paused).toBe(true);
    expect(state.deferredRpcs.map((item) => item.type)).toEqual(['resume_producer']);
    releaseDeferred('resume_producer');
    await waitForDeferred('pause_producer');
    expect(state.serverProducerPaused.get(producer.id)).toBe(false);
    expect(producer.paused).toBe(true);

    releaseDeferred('pause_producer');
    await Promise.all([unmute, mute]);
    expect(state.serverProducerPaused.get(producer.id)).toBe(true);
    expect(producer.paused).toBe(true);
    transport.close();
  });

  it('reconciles a late consumer from delayed deafen to the latest undeafened state', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    await transport.setDeafened(true);
    state.deferGateRpcs = true;

    state.handlers.get('producer_available')?.({
      producer_id: 'late-deafen-first',
      user_id: 77,
      source: 'microphone',
      kind: 'audio',
    });
    await waitForDeferred('pause_consumer');
    const undeafen = transport.setDeafened(false);
    const consumer = state.consumed[0]!;
    expect(consumer.paused).toBe(true);
    expect(state.deferredRpcs.map((item) => item.type)).toEqual(['pause_consumer']);

    releaseDeferred('pause_consumer');
    await waitForDeferred('resume_consumer');
    expect(state.serverConsumerPaused.get(consumer.id)).toBe(true);
    expect(consumer.paused).toBe(true);
    releaseDeferred('resume_consumer');
    await undeafen;

    expect(state.serverConsumerPaused.get(consumer.id)).toBe(false);
    expect(consumer.paused).toBe(false);
    transport.close();
  });

  it('reconciles a late consumer from delayed undeafen to the latest deafened state', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    state.deferGateRpcs = true;

    state.handlers.get('producer_available')?.({
      producer_id: 'late-undeafen-first',
      user_id: 77,
      source: 'microphone',
      kind: 'audio',
    });
    await waitForDeferred('resume_consumer');
    const deafen = transport.setDeafened(true);
    const consumer = state.consumed[0]!;
    expect(consumer.paused).toBe(true);
    expect(state.deferredRpcs.map((item) => item.type)).toEqual(['resume_consumer']);

    releaseDeferred('resume_consumer');
    await waitForDeferred('pause_consumer');
    expect(state.serverConsumerPaused.get(consumer.id)).toBe(false);
    expect(consumer.paused).toBe(true);
    releaseDeferred('pause_consumer');
    await deafen;

    expect(state.serverConsumerPaused.get(consumer.id)).toBe(true);
    expect(consumer.paused).toBe(true);
    transport.close();
  });

  it('does not resume closed media after delayed gate RPCs finish', async () => {
    const transport = new SfuTransport();
    await transport.connect('ws://local/ws/media', 'ticket', track('audio'));
    const producer = state.produced[0]!.producer;
    await transport.setMicrophoneMuted(true);
    state.deferGateRpcs = true;

    const unmute = transport.setMicrophoneMuted(false);
    await waitForDeferred('resume_producer');
    state.handlers.get('producer_available')?.({
      producer_id: 'closing-consumer',
      user_id: 77,
      source: 'microphone',
      kind: 'audio',
    });
    await waitForDeferred('resume_consumer');
    const consumer = state.consumed[0]!;

    transport.close();
    releaseDeferred('resume_producer');
    releaseDeferred('resume_consumer');
    await unmute;
    await vi.waitFor(() => expect(consumer.closed).toBe(true));

    expect(producer.closed).toBe(true);
    expect(producer.paused).toBe(true);
    expect(consumer.paused).toBe(true);
  });
});
