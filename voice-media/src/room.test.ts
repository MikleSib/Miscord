import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Room, RoomRegistry, type Peer } from './room.js';
import type { MediaClaims } from './types.js';
import { workerPool } from './workerPool.js';

class FakeObserver extends EventEmitter {
  readonly addProducer = vi.fn(async () => undefined);
  close(): void {}
}

class FakeRouter {
  readonly observer = new FakeObserver();
  readonly createAudioLevelObserver = vi.fn(async () => this.observer);
  close(): void {}
}

class FakeProducer extends EventEmitter {
  readonly kind: 'audio' | 'video';
  readonly appData: Record<string, unknown>;
  closed = false;

  constructor(readonly id: string, source: 'microphone' | 'screen-video' | 'screen-audio') {
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
    protocol_version: 1,
  };
}

function socket() {
  return {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
  } as never;
}

function addPeer(room: Room, index: number): Peer {
  return room.addPeer(claims(index), socket());
}

let routers: FakeRouter[];
let createCount: number;

beforeEach(() => {
  routers = [];
  createCount = 0;
  vi.spyOn(workerPool, 'createRouter').mockImplementation(async () => {
    createCount += 1;
    await Promise.resolve();
    const router = new FakeRouter();
    routers.push(router);
    return { router, webRtcServer: {}, workerPid: 1234 } as never;
  });
  vi.spyOn(workerPool, 'adjustConsumers').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Room SFU limits', () => {
  it('creates one Router for concurrent joins to the same room', async () => {
    const registry = new RoomRegistry();
    const resolved = await Promise.all(
      Array.from({ length: 10 }, () => registry.getOrCreate(500, 'epoch-1')),
    );

    expect(createCount).toBe(1);
    expect(new Set(resolved).size).toBe(1);
    await expect(registry.getOrCreate(500, 'different-epoch')).rejects.toThrow('Room epoch mismatch');
    registry.close();
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

  it('resumes only four loudest microphone consumers', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consumers.slice(0, 4).every((consumer) => consumer.resume.mock.calls.length === 1)).toBe(true);
    expect(consumers[4]!.pause).toHaveBeenCalledOnce();
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
    expect(consumer.resume).toHaveBeenCalledOnce();

    await room.setConsumerUserPaused(consumer as never, true);
    await room.setExternalProducerSpeaking(producer.id, false);
    await room.setExternalProducerSpeaking(producer.id, true);
    expect(consumer.pause).toHaveBeenCalled();
    expect(consumer.resume).toHaveBeenCalledOnce();
    room.close();
  });
});
