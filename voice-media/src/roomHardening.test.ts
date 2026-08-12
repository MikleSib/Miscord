import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTIVITY_TRANSITION_RETRY_MS, Room, type Peer } from './room.js';
import type { MediaClaims } from './types.js';
import { workerPool } from './workerPool.js';

class FakeObserver extends EventEmitter {
  readonly addProducer = vi.fn(async () => undefined);
  readonly close = vi.fn();
}

class FakeDirectTransport extends EventEmitter {
  closed = false;
  readonly produce = vi.fn();
  readonly consume = vi.fn();

  constructor(readonly id: string, private readonly emitOnClose = true) { super(); }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.emitOnClose) this.emit('@close');
  }
}

class FakeRouter {
  readonly observer = new FakeObserver();
  readonly createAudioLevelObserver = vi.fn(async () => this.observer);
  readonly createDirectTransport = vi.fn();
  readonly close = vi.fn();
}

class FakeProducer extends EventEmitter {
  readonly kind = 'audio';
  readonly appData = { source: 'microphone' };
  closed = false;

  constructor(readonly id: string) { super(); }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('@close');
  }
}

class FakeConsumer extends EventEmitter {
  readonly kind = 'audio';
  readonly appData: Record<string, unknown> = {};
  readonly pause = vi.fn(async () => { this.paused = true; });
  readonly resume = vi.fn(async () => { this.paused = false; });
  closed = false;

  constructor(
    readonly id: string,
    readonly producerId: string,
    public paused = false,
  ) { super(); }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('@close');
  }
}

function claims(index: number, sessionId = `session-${index}`): MediaClaims {
  return {
    sub: String(10_000 + index), jti: `jti-${index}`, channel_id: 700,
    session_id: sessionId, room_epoch: 'hardening-epoch', username: `user-${index}`,
    is_bot: true,
    protocol_version: 1,
  };
}

function socket() {
  return { OPEN: 1, readyState: 1, send: vi.fn(), close: vi.fn() } as never;
}

function addPeer(room: Room, index: number, sessionId?: string): Peer {
  return room.addPeer(claims(index, sessionId), socket());
}

async function flushMicrotasks(count = 16): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

let router: FakeRouter;

beforeEach(() => {
  router = new FakeRouter();
  vi.spyOn(workerPool, 'createRouter').mockResolvedValue({
    router, webRtcServer: {}, workerPid: 4321,
  } as never);
  vi.spyOn(workerPool, 'adjustConsumers').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Room creation ownership', () => {
  it('closes the reserved router when audio observer creation fails', async () => {
    router.createAudioLevelObserver.mockRejectedValueOnce(new Error('observer failed'));

    await expect(Room.create(700, 'hardening-epoch')).rejects.toThrow('observer failed');

    expect(router.close).toHaveBeenCalledOnce();
  });
});

describe('Room direct transport concurrency', () => {
  it('single-flights concurrent creation for the same current peer', async () => {
    let resolve!: (transport: FakeDirectTransport) => void;
    router.createDirectTransport.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const room = await Room.create(700, 'hardening-epoch');
    const peer = addPeer(room, 1);

    const first = room.createDirectTransport(peer);
    const second = room.createDirectTransport(peer);
    expect(router.createDirectTransport).toHaveBeenCalledOnce();
    const transport = new FakeDirectTransport('direct-shared');
    resolve(transport);

    await expect(first).resolves.toBe(transport);
    await expect(second).resolves.toBe(transport);
    expect(room.directTransports.get(peer.claims.session_id)).toBe(transport);
    room.close();
  });

  it('cleans a failed pending creation so the same peer can retry', async () => {
    router.createDirectTransport.mockRejectedValueOnce(new Error('direct failed'));
    const recovered = new FakeDirectTransport('direct-recovered');
    router.createDirectTransport.mockResolvedValueOnce(recovered);
    const room = await Room.create(700, 'hardening-epoch');
    const peer = addPeer(room, 1);

    await expect(room.createDirectTransport(peer)).rejects.toThrow('direct failed');
    await expect(room.createDirectTransport(peer)).resolves.toBe(recovered);
    expect(router.createDirectTransport).toHaveBeenCalledTimes(2);
    room.close();
  });

  it('does not let a stale close event delete a replacement transport', async () => {
    const oldTransport = new FakeDirectTransport('direct-old', false);
    const newTransport = new FakeDirectTransport('direct-new');
    router.createDirectTransport
      .mockResolvedValueOnce(oldTransport)
      .mockResolvedValueOnce(newTransport);
    const room = await Room.create(700, 'hardening-epoch');
    const oldPeer = addPeer(room, 1, 'shared-session');
    await room.createDirectTransport(oldPeer);

    const replacement = addPeer(room, 2, 'shared-session');
    await room.createDirectTransport(replacement);
    oldTransport.emit('@close');

    expect(room.directTransports.get('shared-session')).toBe(newTransport);
    room.close();
  });

  it('closes a candidate resolving after the room was closed', async () => {
    let resolve!: (transport: FakeDirectTransport) => void;
    router.createDirectTransport.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const room = await Room.create(700, 'hardening-epoch');
    const peer = addPeer(room, 1);
    const pending = room.createDirectTransport(peer);

    room.close();
    const candidate = new FakeDirectTransport('direct-too-late');
    resolve(candidate);

    await expect(pending).rejects.toThrow('Media session was replaced');
    expect(candidate.closed).toBe(true);
    expect(room.directTransports.size).toBe(0);
  });

  it('rejects an old pending candidate without deleting the new peer candidate', async () => {
    let resolveOld!: (transport: FakeDirectTransport) => void;
    router.createDirectTransport.mockImplementationOnce(() => new Promise((done) => { resolveOld = done; }));
    const current = new FakeDirectTransport('direct-current');
    router.createDirectTransport.mockResolvedValueOnce(current);
    const room = await Room.create(700, 'hardening-epoch');
    const oldPeer = addPeer(room, 1, 'shared-session');
    const oldPending = room.createDirectTransport(oldPeer);
    const rejected = expect(oldPending).rejects.toThrow('Media session was replaced');

    const newPeer = addPeer(room, 2, 'shared-session');
    await expect(room.createDirectTransport(newPeer)).resolves.toBe(current);
    const stale = new FakeDirectTransport('direct-stale');
    resolveOld(stale);

    await rejected;
    expect(stale.closed).toBe(true);
    expect(room.directTransports.get('shared-session')).toBe(current);
    room.close();
  });
});

describe('Room activity refresh hardening', () => {
  it('rejects a deferred consumer if its producer closes before registration', async () => {
    const room = await Room.create(700, 'hardening-epoch');
    const speaker = addPeer(room, 1);
    const listener = addPeer(room, 2);
    const producer = new FakeProducer('mic-closed-before-consumer');
    const consumer = new FakeConsumer('orphan-consumer', producer.id);
    await room.addProducer(speaker, {} as never, producer as never, 'microphone');
    const candidate = Promise.resolve().then(() => room.addConsumer(listener, consumer as never));

    producer.close();
    await expect(candidate).rejects.toThrow('Producer is no longer available');
    expect(consumer.closed).toBe(true);
    expect(listener.consumers.size).toBe(0);
    expect(workerPool.adjustConsumers).not.toHaveBeenCalled();
    room.close();
  });

  it('rejects an already-closed consumer before registering counters', async () => {
    const room = await Room.create(700, 'hardening-epoch');
    const speaker = addPeer(room, 1);
    const listener = addPeer(room, 2);
    const producer = new FakeProducer('mic-live');
    const consumer = new FakeConsumer('closed-consumer', producer.id);
    await room.addProducer(speaker, {} as never, producer as never, 'microphone');
    consumer.close();

    expect(() => room.addConsumer(listener, consumer as never))
      .toThrow('Producer is no longer available');
    expect(listener.consumers.size).toBe(0);
    expect(workerPool.adjustConsumers).not.toHaveBeenCalled();
    room.close();
  });

  it('contains a rejected observer refresh and retries it', async () => {
    vi.useFakeTimers();
    const room = await Room.create(700, 'hardening-epoch');
    const refresh = vi.spyOn(
      room as unknown as { refreshActiveMicrophones: () => Promise<void> },
      'refreshActiveMicrophones',
    );
    refresh.mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValue(undefined);

    router.observer.emit('silence');
    await vi.runOnlyPendingTimersAsync();
    await flushMicrotasks();
    expect(refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(ACTIVITY_TRANSITION_RETRY_MS);
    await vi.runOnlyPendingTimersAsync();
    await flushMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(2);
    room.close();
  });

  it('resumes an initially paused mediasoup consumer on the first resume request', async () => {
    const room = await Room.create(700, 'hardening-epoch');
    const speaker = addPeer(room, 1);
    const listener = addPeer(room, 2);
    const producer = new FakeProducer('mic-initially-paused');
    await room.addProducer(speaker, {} as never, producer as never, 'microphone');
    const consumer = new FakeConsumer('consumer-initially-paused', producer.id, true);
    room.addConsumer(listener, consumer as never);

    await room.setConsumerUserPaused(consumer as never, false);

    expect(consumer.resume).toHaveBeenCalledOnce();
    expect(consumer.paused).toBe(false);
    room.close();
  });

  it('serializes simultaneous clears of user and activity pause reasons', async () => {
    const room = await Room.create(700, 'hardening-epoch');
    const speaker = addPeer(room, 1);
    const listener = addPeer(room, 2);
    const producer = new FakeProducer('mic-dual-pause');
    await room.addProducer(speaker, {} as never, producer as never, 'microphone');
    const consumer = new FakeConsumer('consumer-dual-pause', producer.id, true);
    room.addConsumer(listener, consumer as never);
    const activity = room as unknown as {
      setConsumerActivityPaused: (consumer: FakeConsumer, paused: boolean) => Promise<void>;
    };
    await room.setConsumerUserPaused(consumer as never, true);
    await activity.setConsumerActivityPaused(consumer, true);
    consumer.resume.mockClear();

    await Promise.all([
      room.setConsumerUserPaused(consumer as never, false),
      activity.setConsumerActivityPaused(consumer, false),
    ]);

    expect(consumer.resume).toHaveBeenCalledOnce();
    expect(consumer.appData).toMatchObject({ userPaused: false, activityPaused: false });
    expect(consumer.paused).toBe(false);
    room.close();
  });

  it('coalesces speaking hints across one hundred different producers', async () => {
    const room = await Room.create(700, 'hardening-epoch');
    const producers: FakeProducer[] = [];
    for (let index = 0; index < 100; index += 1) {
      const peer = addPeer(room, index);
      const producer = new FakeProducer(`mic-${index}`);
      producers.push(producer);
      await room.addProducer(peer, {} as never, producer as never, 'microphone');
    }
    const refresh = vi.spyOn(
      room as unknown as { refreshActiveMicrophones: () => Promise<void> },
      'refreshActiveMicrophones',
    );
    refresh.mockClear();

    await Promise.all(producers.map((producer) => room.setExternalProducerSpeaking(producer.id, true)));

    expect(refresh).toHaveBeenCalledOnce();
    room.close();
  });

  it('does not commit an activity pause until pause succeeds and retries it', async () => {
    const room = await Room.create(700, 'hardening-epoch');
    const producers: FakeProducer[] = [];
    for (let index = 0; index < 5; index += 1) {
      const producer = new FakeProducer(`mic-${index}`);
      producers.push(producer);
      await room.addProducer(addPeer(room, index), {} as never, producer as never, 'microphone');
    }
    const listener = addPeer(room, 200);
    const consumer = new FakeConsumer('consumer-fifth', producers[4]!.id);
    consumer.pause.mockRejectedValueOnce(new Error('pause failed'));
    vi.useFakeTimers();

    room.addConsumer(listener, consumer as never);
    await flushMicrotasks();
    expect(consumer.pause).toHaveBeenCalledOnce();
    expect(consumer.appData.activityPaused).toBe(false);

    await vi.advanceTimersByTimeAsync(ACTIVITY_TRANSITION_RETRY_MS);
    await vi.runOnlyPendingTimersAsync();
    await flushMicrotasks();
    expect(consumer.pause).toHaveBeenCalledTimes(2);
    expect(consumer.appData.activityPaused).toBe(true);
    room.close();
  });
});
