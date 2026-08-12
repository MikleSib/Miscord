import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applySpeakingHint,
  MEDIA_RPC_METRIC_TYPES,
  MediaGateway,
  normalizeRpcMetricType,
  requireCanProduceSource,
  requireConsumerAvailable,
  requireSourceAvailable,
  SerialTaskQueue,
} from './mediaGateway.js';
import { metrics } from './metrics.js';
import { rooms, type RoomLease } from './roomRegistry.js';
import { ticketVerifier } from './ticketVerifier.js';

class FakeSocket extends EventEmitter {
  readyState = 1;
  readonly send = vi.fn();
  readonly close = vi.fn();
}

async function attachGateway(gateway: MediaGateway, socket: FakeSocket): Promise<void> {
  const handle = Reflect.get(gateway, 'handle') as (client: unknown, request: unknown) => Promise<void>;
  await handle.call(gateway, socket, {});
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe('media gateway RPC metrics', () => {
  it('bounds metric label cardinality to the supported RPC allowlist', () => {
    const untrusted = Array.from({ length: 1_000 }, (_, index) => `attacker-${index}`);
    const labels = [
      ...MEDIA_RPC_METRIC_TYPES.map((type) => normalizeRpcMetricType(type)),
      ...untrusted.map((type) => normalizeRpcMetricType(type)),
      normalizeRpcMetricType(null),
      normalizeRpcMetricType(123),
    ];

    expect(new Set(labels)).toEqual(new Set([...MEDIA_RPC_METRIC_TYPES, 'unknown']));
    expect(untrusted.every((type) => normalizeRpcMetricType(type) === 'unknown')).toBe(true);
  });

  it('records an unsupported wire request under the bounded unknown label', async () => {
    const gateway = new MediaGateway();
    const socket = new FakeSocket();
    const observe = vi.spyOn(metrics.rpcDuration, 'observe');
    await attachGateway(gateway, socket);

    socket.emit('message', Buffer.from(JSON.stringify({ type: 'attacker-cardinality-value' })));
    await vi.waitFor(() => expect(observe).toHaveBeenCalled());

    expect(observe).toHaveBeenLastCalledWith(
      { type: 'unknown' },
      expect.any(Number),
    );
    socket.emit('close', 1000);
  });

  it('releases a room reservation when the socket closes during room creation', async () => {
    const gateway = new MediaGateway();
    const socket = new FakeSocket();
    const pendingLease = deferred<RoomLease>();
    const release = vi.fn();
    const addPeer = vi.fn();
    vi.spyOn(ticketVerifier, 'verify').mockResolvedValue({
      sub: '42', jti: 'jti', channel_id: 500, session_id: 'session',
      room_epoch: 'epoch-1', username: 'tester', protocol_version: 1,
    });
    vi.spyOn(rooms, 'acquire').mockReturnValue(pendingLease.promise);
    await attachGateway(gateway, socket);

    socket.emit('message', Buffer.from(JSON.stringify({ type: 'identify', ticket: 'test' })));
    await vi.waitFor(() => expect(ticketVerifier.verify).toHaveBeenCalledOnce());
    socket.emit('close', 1000);
    pendingLease.resolve({ room: { addPeer } as never, release });
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());

    expect(addPeer).not.toHaveBeenCalled();
  });
});

function producer(id: string, source: 'microphone' | 'screen-audio') {
  return { id, kind: 'audio', appData: { source } };
}

function peerWith(...producers: ReturnType<typeof producer>[]) {
  return { producers: new Map(producers.map((item) => [item.id, item])) } as never;
}

describe('media gateway speaking hints', () => {
  it('accepts an owned microphone producer', async () => {
    const microphone = producer('mic-owned', 'microphone');
    const room = { setExternalProducerSpeaking: vi.fn(async () => undefined) } as never;

    await applySpeakingHint(room, peerWith(microphone), {
      type: 'set_speaking',
      producer_id: microphone.id,
      speaking: true,
    });

    expect(room.setExternalProducerSpeaking).toHaveBeenCalledWith(microphone.id, true);
  });

  it('rejects a producer not owned by the requesting peer', async () => {
    const room = { setExternalProducerSpeaking: vi.fn(async () => undefined) } as never;

    await expect(applySpeakingHint(room, peerWith(), {
      type: 'set_speaking',
      producer_id: 'foreign-microphone',
      speaking: true,
    })).rejects.toThrow('Owned producer not found');
    expect(room.setExternalProducerSpeaking).not.toHaveBeenCalled();
  });

  it('rejects an owned non-microphone producer', async () => {
    const screenAudio = producer('screen-audio-owned', 'screen-audio');
    const room = { setExternalProducerSpeaking: vi.fn(async () => undefined) } as never;

    await expect(applySpeakingHint(room, peerWith(screenAudio), {
      type: 'set_speaking',
      producer_id: screenAudio.id,
      speaking: true,
    })).rejects.toThrow('Owned microphone producer required');
    expect(room.setExternalProducerSpeaking).not.toHaveBeenCalled();
  });

  it('requires SPEAK permission for microphone and screen audio producers', () => {
    const denied = { claims: { can_speak: false, can_stream: false } } as never;
    const missing = { claims: {} } as never;
    const allowed = { claims: { can_speak: true, can_stream: true } } as never;

    expect(() => requireCanProduceSource(denied, 'microphone')).toThrow('SPEAK permission required');
    expect(() => requireCanProduceSource(missing, 'screen-audio')).toThrow('SPEAK permission required');
    expect(() => requireCanProduceSource(allowed, 'microphone')).not.toThrow();
    expect(() => requireCanProduceSource(denied, 'screen-video')).toThrow('STREAM permission required');
    expect(() => requireCanProduceSource(allowed, 'screen-video')).not.toThrow();
  });

  it('rejects a duplicate source before allocating another producer', () => {
    const peer = { sourceProducers: new Map([['microphone', 'existing-mic']]) } as never;

    expect(() => requireSourceAvailable(peer, 'microphone'))
      .toThrow('microphone producer already exists');
    expect(() => requireSourceAvailable(peer, 'screen-audio')).not.toThrow();
  });

  it('rejects consuming the same producer twice for one peer', () => {
    const peer = {
      consumers: new Map([['consumer-1', { producerId: 'producer-1' }]]),
    } as never;

    expect(() => requireConsumerAvailable(peer, 'producer-1'))
      .toThrow('Producer is already consumed by this peer');
    expect(() => requireConsumerAvailable(peer, 'producer-2')).not.toThrow();
  });

  it('serializes websocket RPC work when the first task is slow', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const events: string[] = [];
    const queue = new SerialTaskQueue();
    const first = queue.run(async () => {
      events.push('first-start');
      await firstGate;
      events.push('first-end');
    });
    const second = queue.run(async () => { events.push('second'); });

    await vi.waitFor(() => expect(events).toEqual(['first-start']));
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second']);
  });

  it('bounds queued websocket RPC work while a request is blocked', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const queue = new SerialTaskQueue(2);
    const first = queue.run(() => firstGate);
    const second = queue.run(async () => undefined);

    await expect(queue.run(async () => undefined))
      .rejects.toThrow('Media request queue limit exceeded');
    releaseFirst();
    await Promise.all([first, second]);
  });
});
