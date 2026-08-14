import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUDIO_LEVEL_OBSERVER_INTERVAL_MS,
  EXTERNAL_SPEAKING_HINT_BACKOFF_MS,
  EXTERNAL_SPEAKING_HINT_TTL_MS,
  Room,
  type Peer,
} from './room.js';
import type { MediaClaims } from './types.js';
import { workerPool } from './workerPool.js';
import { metrics } from './metrics.js';

class FakeObserver extends EventEmitter {
  readonly addProducer = vi.fn(async () => undefined);
  readonly close = vi.fn();
}

class FakeRouter {
  readonly observer = new FakeObserver();
  readonly createAudioLevelObserver = vi.fn(async () => this.observer);
  readonly createWebRtcTransport = vi.fn();
  readonly close = vi.fn();
}

class FakeWebRtcTransport extends EventEmitter {
  readonly id = `transport-${Math.random()}`;
  readonly iceParameters = {};
  readonly iceCandidates: unknown[] = [];
  readonly dtlsParameters = {};
  readonly sctpParameters = undefined;
  readonly setMaxIncomingBitrate = vi.fn(async () => undefined);
  closed = false;

  constructor(readonly appData: { direction: 'send' | 'recv' }) { super(); }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('@close');
  }
}

class FakeProducer extends EventEmitter {
  readonly kind: 'audio' | 'video';
  readonly appData: Record<string, unknown>;
  closed = false;

  constructor(readonly id: string, source: 'microphone' | 'screen-video' | 'screen-audio' | 'soundboard') {
    super();
    this.kind = source === 'screen-video' ? 'video' : 'audio';
    this.appData = { source };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('@close');
  }
}

class FakeConsumer extends EventEmitter {
  readonly kind = 'audio';
  readonly appData: Record<string, unknown> = {};
  readonly pause = vi.fn(async () => undefined);
  readonly resume = vi.fn(async () => undefined);

  constructor(readonly id: string, readonly producerId: string) {
    super();
  }

  close(): void { this.emit('@close'); }
}

function claims(index: number): MediaClaims {
  return {
    sub: String(1000 + index),
    jti: `jti-${index}`,
    channel_id: 500,
    session_id: `session-${index}`,
    room_epoch: 'epoch-1',
    username: `user-${index}`,
    is_bot: true,
    protocol_version: 1,
  };
}

function socket() {
  return {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  } as never;
}

function addPeer(room: Room, index: number): Peer {
  return room.addPeer(claims(index), socket());
}

async function flushActivityUpdates(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

let routers: FakeRouter[];

beforeEach(() => {
  routers = [];
  vi.spyOn(workerPool, 'createRouter').mockImplementation(async () => {
    await Promise.resolve();
    const router = new FakeRouter();
    routers.push(router);
    return { router, webRtcServer: {}, workerPid: 1234 } as never;
  });
  vi.spyOn(workerPool, 'adjustConsumers').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Room SFU limits', () => {
  it('uses the minimum supported audio observer interval as a fallback', async () => {
    const room = await Room.create(500, 'epoch-1');
    expect(routers[0]!.createAudioLevelObserver).toHaveBeenCalledWith({
      maxEntries: 8,
      threshold: -80,
      interval: AUDIO_LEVEL_OBSERVER_INTERVAL_MS,
    });
    expect(AUDIO_LEVEL_OBSERVER_INTERVAL_MS).toBe(250);
    room.close();
  });

  it('closes idempotently even when onEmpty recursively closes the room', async () => {
    const roomsDec = vi.spyOn(metrics.rooms, 'dec');
    const room = await Room.create(500, 'epoch-1');
    addPeer(room, 0);
    room.onEmpty(() => room.close());

    room.close();
    room.close();

    expect(routers[0]!.observer.close).toHaveBeenCalledOnce();
    expect(routers[0]!.close).toHaveBeenCalledOnce();
    expect(roomsDec).toHaveBeenCalledOnce();
  });

  it('keeps a replacement peer when the old socket closes later', async () => {
    const room = await Room.create(500, 'epoch-1');
    const oldSocket = { OPEN: 1, readyState: 1, send: vi.fn(), close: vi.fn() };
    const nextSocket = { OPEN: 1, readyState: 1, send: vi.fn(), close: vi.fn() };
    const oldPeer = room.addPeer(claims(0), oldSocket as never);
    const nextPeer = room.addPeer(claims(0), nextSocket as never);

    expect(oldSocket.close).toHaveBeenCalledWith(4000, 'Media session replaced');
    expect(room.isCurrentPeer(nextPeer)).toBe(true);
    room.removePeer(oldPeer.claims.session_id, oldPeer);
    expect(room.isCurrentPeer(nextPeer)).toBe(true);

    const staleConsumer = new FakeConsumer('stale-consumer', 'producer-1');
    const close = vi.spyOn(staleConsumer, 'close');
    expect(() => room.addConsumer(oldPeer, staleConsumer as never))
      .toThrow('Media session was replaced');
    expect(close).toHaveBeenCalledOnce();
    room.close();
  });

  it('closes an unregistered send transport when bitrate setup fails', async () => {
    const room = await Room.create(500, 'epoch-1');
    const peer = addPeer(room, 0);
    const transport = new FakeWebRtcTransport({ direction: 'send' });
    transport.setMaxIncomingBitrate.mockRejectedValueOnce(new Error('bitrate failed'));
    routers[0]!.createWebRtcTransport.mockResolvedValueOnce(transport);

    await expect(room.createWebRtcTransport(peer, 'send')).rejects.toThrow('bitrate failed');
    expect(transport.closed).toBe(true);
    expect(peer.transports.size).toBe(0);
    room.close();
  });

  it('closes a send transport replaced while bitrate setup is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const room = await Room.create(500, 'epoch-1');
    const peer = addPeer(room, 0);
    const transport = new FakeWebRtcTransport({ direction: 'send' });
    transport.setMaxIncomingBitrate.mockImplementationOnce(() => gate);
    routers[0]!.createWebRtcTransport.mockResolvedValueOnce(transport);
    const pending = room.createWebRtcTransport(peer, 'send');
    const rejected = expect(pending).rejects.toThrow('Media session was replaced');

    await vi.waitFor(() => expect(transport.setMaxIncomingBitrate).toHaveBeenCalledOnce());
    const replacement = room.addPeer(claims(0), socket());
    release();
    await rejected;
    expect(transport.closed).toBe(true);
    expect(room.isCurrentPeer(replacement)).toBe(true);
    room.close();
  });

  it('cleans a producer replaced while observer setup is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const room = await Room.create(500, 'epoch-1');
    const peer = addPeer(room, 0);
    const producer = new FakeProducer('pending-mic', 'microphone');
    routers[0]!.observer.addProducer.mockImplementationOnce(() => gate);
    const pending = room.addProducer(peer, {} as never, producer as never, 'microphone');
    const rejected = expect(pending).rejects.toThrow('Media session was replaced');

    await vi.waitFor(() => expect(routers[0]!.observer.addProducer).toHaveBeenCalled());
    const replacement = room.addPeer(claims(0), socket());
    release();
    await rejected;
    expect(producer.closed).toBe(true);
    expect(peer.producers.size).toBe(0);
    expect(room.isCurrentPeer(replacement)).toBe(true);
    room.close();
  });

  it('cleans a producer when observer registration fails', async () => {
    const room = await Room.create(500, 'epoch-1');
    const peer = addPeer(room, 0);
    const producer = new FakeProducer('failed-mic', 'microphone');
    routers[0]!.observer.addProducer.mockRejectedValueOnce(new Error('observer failed'));

    await expect(room.addProducer(peer, {} as never, producer as never, 'microphone'))
      .rejects.toThrow('observer failed');
    expect(producer.closed).toBe(true);
    expect(peer.producers.size).toBe(0);
    expect(peer.sourceProducers.size).toBe(0);
    room.close();
  });

  it('allows ten concurrent screen shares and rejects the eleventh', async () => {
    const room = await Room.create(500, 'epoch-1');
    const peers = Array.from({ length: 11 }, (_, index) => addPeer(room, index));

    for (let index = 0; index < 10; index += 1) {
      const producer = new FakeProducer(`screen-${index}`, 'screen-video');
      await room.addProducer(peers[index]!, {} as never, producer as never, 'screen-video');
    }

    const rejected = new FakeProducer('screen-10', 'screen-video');
    await expect(room.addProducer(peers[10]!, {} as never, rejected as never, 'screen-video'))
      .rejects.toThrow('Screen share capacity reached');
    expect(rejected.closed).toBe(true);

    const audio = new FakeProducer('screen-audio-0', 'screen-audio');
    await expect(room.addProducer(peers[0]!, {} as never, audio as never, 'screen-audio')).resolves.toBeUndefined();
    room.close();
  });

  it('allows at most two simultaneous soundboard producers per room', async () => {
    const room = await Room.create(500, 'epoch-1');
    const peers = [addPeer(room, 0), addPeer(room, 1), addPeer(room, 2)];
    await room.addProducer(peers[0]!, {} as never, new FakeProducer('sound-0', 'soundboard') as never, 'soundboard');
    await room.addProducer(peers[1]!, {} as never, new FakeProducer('sound-1', 'soundboard') as never, 'soundboard');
    const rejected = new FakeProducer('sound-2', 'soundboard');
    await expect(room.addProducer(peers[2]!, {} as never, rejected as never, 'soundboard'))
      .rejects.toThrow('Soundboard capacity reached');
    expect(rejected.closed).toBe(true);
    room.close();
  });

  it('closes a duplicate source producer instead of leaking it', async () => {
    const room = await Room.create(500, 'epoch-1');
    const peer = addPeer(room, 0);
    const first = new FakeProducer('mic-first', 'microphone');
    const duplicate = new FakeProducer('mic-duplicate', 'microphone');

    await room.addProducer(peer, {} as never, first as never, 'microphone');
    await expect(room.addProducer(peer, {} as never, duplicate as never, 'microphone'))
      .rejects.toThrow('microphone producer already exists');
    expect(duplicate.closed).toBe(true);
    expect(peer.producers.has(duplicate.id)).toBe(false);
    room.close();
  });

  it('never activity-pauses microphone consumers when the room has four or fewer producers', async () => {
    const room = await Room.create(500, 'epoch-1');
    const speakers = Array.from({ length: 4 }, (_, index) => addPeer(room, index));
    const listener = room.addPeer({ ...claims(20), is_bot: false }, socket());
    const producers: FakeProducer[] = [];
    const consumers: FakeConsumer[] = [];

    for (let index = 0; index < speakers.length; index += 1) {
      const producer = new FakeProducer(`mic-${index}`, 'microphone');
      const consumer = new FakeConsumer(`consumer-${index}`, producer.id);
      producers.push(producer);
      consumers.push(consumer);
      await room.addProducer(speakers[index]!, {} as never, producer as never, 'microphone');
      room.addConsumer(listener, consumer as never);
    }

    routers[0]!.observer.emit('volumes', [{ producer: producers[0], volume: -20 }]);
    await flushActivityUpdates();
    routers[0]!.observer.emit('silence');
    await flushActivityUpdates();

    expect(consumers.every((consumer) => consumer.appData.activityPaused === false)).toBe(true);
    expect(consumers.every((consumer) => consumer.pause.mock.calls.length === 0)).toBe(true);
    expect(consumers.every((consumer) => consumer.resume.mock.calls.length === 0)).toBe(true);
    const messages = (listener.socket.send as ReturnType<typeof vi.fn>).mock.calls
      .map(([payload]) => JSON.parse(String(payload)) as { type: string; user_ids?: number[] });
    expect(messages).toContainEqual({ type: 'active_speakers', user_ids: [1000] });
    expect(messages).toContainEqual({ type: 'active_speakers', user_ids: [] });
    room.close();
  });

  it('gates a fifth microphone without churning an unchanged selected set', async () => {
    const room = await Room.create(500, 'epoch-1');
    const speakers = Array.from({ length: 5 }, (_, index) => addPeer(room, index));
    const listener = addPeer(room, 20);
    const producers: FakeProducer[] = [];
    const consumers: FakeConsumer[] = [];

    for (let index = 0; index < speakers.length; index += 1) {
      const producer = new FakeProducer(`mic-${index}`, 'microphone');
      const consumer = new FakeConsumer(`consumer-${index}`, producer.id);
      producers.push(producer);
      consumers.push(consumer);
      await room.addProducer(speakers[index]!, {} as never, producer as never, 'microphone');
      room.addConsumer(listener, consumer as never);
    }

    routers[0]!.observer.emit('volumes', producers.map((producer) => ({ producer, volume: -20 })));
    await flushActivityUpdates();
    expect(consumers.slice(0, 4).every((consumer) => consumer.appData.activityPaused === false)).toBe(true);
    expect(consumers[4]!.appData.activityPaused).toBe(true);

    consumers.forEach((consumer) => {
      consumer.pause.mockClear();
      consumer.resume.mockClear();
    });
    routers[0]!.observer.emit('volumes', producers.slice(0, 4).reverse()
      .map((producer) => ({ producer, volume: -20 })));
    await flushActivityUpdates();
    expect(consumers.every((consumer) => consumer.pause.mock.calls.length === 0)).toBe(true);
    expect(consumers.every((consumer) => consumer.resume.mock.calls.length === 0)).toBe(true);
    room.close();
  });

  it('switches to a newly active microphone once and keeps the selected set stable', async () => {
    const room = await Room.create(500, 'epoch-1');
    const speakers = Array.from({ length: 5 }, (_, index) => addPeer(room, index));
    const listener = addPeer(room, 20);
    const producers: FakeProducer[] = [];
    const consumers: FakeConsumer[] = [];

    for (let index = 0; index < speakers.length; index += 1) {
      const producer = new FakeProducer(`mic-${index}`, 'microphone');
      const consumer = new FakeConsumer(`consumer-${index}`, producer.id);
      producers.push(producer);
      consumers.push(consumer);
      await room.addProducer(speakers[index]!, {} as never, producer as never, 'microphone');
      room.addConsumer(listener, consumer as never);
    }
    routers[0]!.observer.emit('volumes', producers.slice(0, 4)
      .map((producer) => ({ producer, volume: -20 })));
    await flushActivityUpdates();
    consumers.forEach((consumer) => {
      consumer.pause.mockClear();
      consumer.resume.mockClear();
    });

    const nextActive = [producers[4]!, producers[0]!, producers[1]!, producers[2]!];
    routers[0]!.observer.emit('volumes', nextActive.map((producer) => ({ producer, volume: -20 })));
    await flushActivityUpdates();
    expect(consumers[3]!.pause).toHaveBeenCalledOnce();
    expect(consumers[4]!.resume).toHaveBeenCalledOnce();

    consumers.forEach((consumer) => {
      consumer.pause.mockClear();
      consumer.resume.mockClear();
    });
    routers[0]!.observer.emit('volumes', nextActive.reverse()
      .map((producer) => ({ producer, volume: -20 })));
    await flushActivityUpdates();
    expect(consumers.every((consumer) => consumer.pause.mock.calls.length === 0)).toBe(true);
    expect(consumers.every((consumer) => consumer.resume.mock.calls.length === 0)).toBe(true);
    room.close();
  });

  it('never pauses all selected microphones after silence', async () => {
    const room = await Room.create(500, 'epoch-1');
    const speakers = Array.from({ length: 5 }, (_, index) => addPeer(room, index));
    const listener = addPeer(room, 20);
    const producers: FakeProducer[] = [];
    const consumers: FakeConsumer[] = [];

    for (let index = 0; index < speakers.length; index += 1) {
      const producer = new FakeProducer(`mic-${index}`, 'microphone');
      const consumer = new FakeConsumer(`consumer-${index}`, producer.id);
      producers.push(producer);
      consumers.push(consumer);
      await room.addProducer(speakers[index]!, {} as never, producer as never, 'microphone');
      room.addConsumer(listener, consumer as never);
    }
    routers[0]!.observer.emit('volumes', producers.slice(0, 4)
      .map((producer) => ({ producer, volume: -20 })));
    await flushActivityUpdates();
    consumers.forEach((consumer) => consumer.pause.mockClear());

    routers[0]!.observer.emit('silence');
    await flushActivityUpdates();
    expect(consumers.slice(0, 4).every((consumer) => consumer.pause.mock.calls.length === 0)).toBe(true);
    expect(consumers[4]!.appData.activityPaused).toBe(true);
    room.close();
  });

  it('immediately replaces a retained microphone from an explicit client VAD hint', async () => {
    const room = await Room.create(500, 'epoch-1');
    const speakers = Array.from({ length: 5 }, (_, index) => addPeer(room, index));
    const listener = addPeer(room, 20);
    const producers: FakeProducer[] = [];
    const consumers: FakeConsumer[] = [];

    for (let index = 0; index < speakers.length; index += 1) {
      const producer = new FakeProducer(`mic-${index}`, 'microphone');
      const consumer = new FakeConsumer(`consumer-${index}`, producer.id);
      producers.push(producer);
      consumers.push(consumer);
      await room.addProducer(speakers[index]!, {} as never, producer as never, 'microphone');
      room.addConsumer(listener, consumer as never);
    }
    await flushActivityUpdates();
    expect(consumers[4]!.appData.activityPaused).toBe(true);
    consumers.forEach((consumer) => {
      consumer.pause.mockClear();
      consumer.resume.mockClear();
    });

    await room.setExternalProducerSpeaking(producers[4]!.id, true);
    expect(consumers[3]!.pause).toHaveBeenCalledOnce();
    expect(consumers[4]!.resume).toHaveBeenCalledOnce();
    expect(consumers.filter((consumer) => consumer.appData.activityPaused === false)).toHaveLength(4);
    room.close();
  });

  it('coalesces duplicate speech-end hints without rescanning the room', async () => {
    const room = await Room.create(500, 'epoch-1');
    const speaker = addPeer(room, 1);
    const producer = new FakeProducer('mic-1', 'microphone');
    await room.addProducer(speaker, {} as never, producer as never, 'microphone');
    const refresh = vi.spyOn(
      room as unknown as { refreshActiveMicrophones: () => Promise<void> },
      'refreshActiveMicrophones',
    );
    refresh.mockClear();

    await Promise.all(Array.from(
      { length: 100 },
      () => room.setExternalProducerSpeaking(producer.id, false),
    ));

    expect(refresh).not.toHaveBeenCalled();
    room.close();
  });

  it('serializes and rate-limits alternating speech hints per producer', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const room = await Room.create(500, 'epoch-1');
    const speaker = addPeer(room, 1);
    const producer = new FakeProducer('mic-alternating', 'microphone');
    await room.addProducer(speaker, {} as never, producer as never, 'microphone');
    const refresh = vi.spyOn(
      room as unknown as { refreshActiveMicrophones: () => Promise<void> },
      'refreshActiveMicrophones',
    );
    let releaseFirst!: () => void;
    const firstRefreshBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    refresh.mockImplementation(async () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (calls === 1) await firstRefreshBlocked;
      inFlight -= 1;
    });

    const burst = () => Promise.all(Array.from(
      { length: 100 },
      (_, index) => room.setExternalProducerSpeaking(producer.id, index % 2 === 0),
    ));
    const firstBurst = burst();
    await flushActivityUpdates();
    expect(refresh).toHaveBeenCalledOnce();
    expect(maxInFlight).toBe(1);
    releaseFirst();
    await firstBurst;
    expect(refresh).toHaveBeenCalledOnce();
    expect(maxInFlight).toBe(1);

    await burst();
    expect(refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(EXTERNAL_SPEAKING_HINT_BACKOFF_MS - 1);
    await burst();
    expect(refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await burst();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
    room.close();
  });

  it('expires an unverified client hint and restores observer-selected microphones', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const room = await Room.create(500, 'epoch-1');
    const speakers = Array.from({ length: 5 }, (_, index) => addPeer(room, index));
    const listener = addPeer(room, 20);
    const producers: FakeProducer[] = [];
    const consumers: FakeConsumer[] = [];

    for (let index = 0; index < speakers.length; index += 1) {
      const producer = new FakeProducer(`mic-${index}`, 'microphone');
      const consumer = new FakeConsumer(`consumer-${index}`, producer.id);
      producers.push(producer);
      consumers.push(consumer);
      await room.addProducer(speakers[index]!, {} as never, producer as never, 'microphone');
      room.addConsumer(listener, consumer as never);
    }
    routers[0]!.observer.emit('volumes', producers.slice(0, 4)
      .map((producer) => ({ producer, volume: -20 })));
    await flushActivityUpdates();

    await room.setExternalProducerSpeaking(producers[4]!.id, true);
    expect(consumers[3]!.appData.activityPaused).toBe(true);
    expect(consumers[4]!.appData.activityPaused).toBe(false);
    consumers.forEach((consumer) => {
      consumer.pause.mockClear();
      consumer.resume.mockClear();
    });

    await vi.advanceTimersByTimeAsync(EXTERNAL_SPEAKING_HINT_TTL_MS);
    await flushActivityUpdates();
    expect(consumers[3]!.resume).toHaveBeenCalledOnce();
    expect(consumers[4]!.pause).toHaveBeenCalledOnce();
    expect(consumers.filter((consumer) => consumer.appData.activityPaused === false)).toHaveLength(4);

    consumers.forEach((consumer) => {
      consumer.pause.mockClear();
      consumer.resume.mockClear();
    });
    await room.setExternalProducerSpeaking(producers[4]!.id, true);
    expect(consumers[4]!.appData.activityPaused).toBe(true);
    await vi.advanceTimersByTimeAsync(
      EXTERNAL_SPEAKING_HINT_BACKOFF_MS - EXTERNAL_SPEAKING_HINT_TTL_MS,
    );
    await room.setExternalProducerSpeaking(producers[4]!.id, true);
    expect(consumers[4]!.appData.activityPaused).toBe(false);
    room.close();
  });

  it('uses bot Speaking state and preserves a listener deafen pause', async () => {
    const room = await Room.create(500, 'epoch-1');
    const botClaims = { ...claims(30), is_bot: true };
    const bot = room.addPeer(botClaims, socket());
    const listener = addPeer(room, 31);
    const producer = new FakeProducer('bot-mic', 'microphone');
    const consumer = new FakeConsumer('bot-consumer', producer.id);

    await room.addProducer(bot, {} as never, producer as never, 'microphone');
    room.addConsumer(listener, consumer as never);
    await room.setExternalProducerSpeaking(producer.id, true);
    expect(consumer.resume).not.toHaveBeenCalled();
    expect(consumer.pause).not.toHaveBeenCalled();

    await room.setConsumerUserPaused(consumer as never, true);
    await room.setExternalProducerSpeaking(producer.id, false);
    await room.setExternalProducerSpeaking(producer.id, true);
    expect(consumer.pause).toHaveBeenCalledOnce();
    expect(consumer.resume).not.toHaveBeenCalled();
    await room.setConsumerUserPaused(consumer as never, false);
    expect(consumer.resume).toHaveBeenCalledOnce();
    room.close();
  });
});
