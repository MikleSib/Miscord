import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { metrics } from '../metrics.js';
import type { MediaClaims } from '../types.js';
import { BotMediaSession, UdpEdge } from './udpEdge.js';

class FakeProducer extends EventEmitter {
  readonly kind = 'audio';
  readonly appData = { source: 'microphone' };
  readonly close = vi.fn(() => this.emit('@close'));

  constructor(readonly id = 'bot-producer') { super(); }
}

class FakeDirectTransport extends EventEmitter {
  closed = false;
  readonly produce = vi.fn(async () => new FakeProducer());
  readonly consume = vi.fn();
  readonly close = vi.fn(() => {
    this.closed = true;
    this.emit('@close');
  });
}

class FakeRoom extends EventEmitter {
  readonly peer = {
    claims: botClaims(), socket: {}, transports: new Map(), producers: new Map(),
    consumers: new Map(), sourceProducers: new Map(),
  };
  readonly direct = new FakeDirectTransport();
  readonly router = { rtpCapabilities: {} };
  current = true;
  readonly addPeer = vi.fn(() => this.peer);
  readonly createDirectTransport = vi.fn(async () => this.direct);
  readonly addProducer = vi.fn(async () => undefined);
  readonly descriptors = vi.fn(() => []);
  readonly producerOwner = vi.fn();
  readonly addConsumer = vi.fn();
  readonly removePeer = vi.fn(() => { this.current = false; });
  readonly setExternalProducerSpeaking = vi.fn(async () => undefined);

  isCurrentPeer(peer: unknown): boolean {
    return this.current && peer === this.peer;
  }
}

function botClaims(): MediaClaims {
  return {
    sub: '123', jti: 'bot-jti', channel_id: 42, guild_id: 42,
    session_id: 'bot-session', room_epoch: 'bot-epoch', username: 'bot',
    protocol_version: 1, is_bot: true, can_speak: true,
  };
}

function openSocket() {
  return { OPEN: 1, readyState: 1 } as never;
}

function session(room: FakeRoom): BotMediaSession {
  return new BotMediaSession(botClaims(), room as never, openSocket(), { sendOp: vi.fn() }, 20_100);
}

afterEach(() => vi.restoreAllMocks());

describe('BotMediaSession transactional lifecycle', () => {
  it('removes the exact peer and all partial resources when producer registration fails', async () => {
    const room = new FakeRoom();
    room.addProducer.mockRejectedValueOnce(new Error('observer failed'));
    const producerClose = vi.spyOn(metrics.botSessions, 'dec');
    const media = session(room);

    await expect(media.start()).rejects.toThrow('observer failed');

    const producer = await room.direct.produce.mock.results[0]!.value as FakeProducer;
    expect(producer.close).toHaveBeenCalled();
    expect(room.direct.close).toHaveBeenCalled();
    expect(room.removePeer).toHaveBeenCalledWith('bot-session', room.peer);
    expect(room.listenerCount('producerAvailable')).toBe(0);
    expect(producerClose).not.toHaveBeenCalled();
  });

  it('cleans handlers and resources if initial consumer setup rejects', async () => {
    const room = new FakeRoom();
    const foreign = new FakeProducer('foreign-producer');
    const owner = { claims: { sub: '456', session_id: 'other-session' }, producers: new Map() };
    room.descriptors.mockReturnValueOnce([{
      producer_id: foreign.id, user_id: 456, source: 'microphone', kind: 'audio',
    }]);
    room.producerOwner.mockReturnValue(owner);
    owner.producers.set(foreign.id, foreign);
    room.direct.consume.mockRejectedValueOnce(new Error('consume failed'));
    const media = session(room);

    await expect(media.start()).rejects.toThrow('consume failed');

    expect(room.listenerCount('producerAvailable')).toBe(0);
    expect(room.listenerCount('producerClosed')).toBe(0);
    expect(room.removePeer).toHaveBeenCalledWith('bot-session', room.peer);
  });

  it('increments and decrements the session metric exactly once', async () => {
    const room = new FakeRoom();
    const inc = vi.spyOn(metrics.botSessions, 'inc');
    const dec = vi.spyOn(metrics.botSessions, 'dec');
    const media = session(room);

    await media.start();
    media.close();
    media.close();

    expect(inc).toHaveBeenCalledOnce();
    expect(dec).toHaveBeenCalledOnce();
    expect(room.removePeer).toHaveBeenCalledOnce();
  });
});

describe('UdpEdge replacement identity', () => {
  it('does not remove replacement SSRC or remote mappings when a stale session unregisters', () => {
    const edge = new UdpEdge();
    const remote = { address: '127.0.0.1', port: 50_000 };
    const stale = { ssrc: 123, remote } as BotMediaSession;
    const replacement = { ssrc: 123, remote } as BotMediaSession;
    const state = edge as unknown as {
      bySsrc: Map<number, BotMediaSession>;
      byRemote: Map<string, BotMediaSession>;
    };
    edge.register(stale);
    edge.register(replacement);
    state.byRemote.set('127.0.0.1:50000', replacement);

    edge.unregister(stale);

    expect(state.bySsrc.get(123)).toBe(replacement);
    expect(state.byRemote.get('127.0.0.1:50000')).toBe(replacement);
  });
});
