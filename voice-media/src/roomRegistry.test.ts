import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RoomRegistry } from './roomRegistry.js';
import type { MediaClaims } from './types.js';
import { workerPool } from './workerPool.js';

class FakeObserver extends EventEmitter {
  readonly close = vi.fn();
}

class FakeRouter {
  readonly observer = new FakeObserver();
  readonly createAudioLevelObserver = vi.fn(async () => this.observer);
  readonly close = vi.fn();
}

function claims(sessionId: string): MediaClaims {
  return {
    sub: sessionId,
    jti: `jti-${sessionId}`,
    channel_id: 500,
    session_id: sessionId,
    room_epoch: 'epoch-1',
    username: sessionId,
    protocol_version: 1,
  };
}

function socket() {
  return { OPEN: 1, readyState: 1, send: vi.fn(), close: vi.fn() } as never;
}

let routers: FakeRouter[];

beforeEach(() => {
  routers = [];
  vi.spyOn(workerPool, 'createRouter').mockImplementation(async () => {
    const router = new FakeRouter();
    routers.push(router);
    return { router, webRtcServer: {}, workerPid: 1234 } as never;
  });
});

afterEach(() => vi.restoreAllMocks());

describe('RoomRegistry leases', () => {
  it('creates one room for concurrent reservations and discards it after the last release', async () => {
    const registry = new RoomRegistry();
    const leases = await Promise.all(
      Array.from({ length: 10 }, () => registry.acquire(500, 'epoch-1')),
    );

    expect(routers).toHaveLength(1);
    expect(new Set(leases.map(({ room }) => room))).toHaveLength(1);
    await expect(registry.acquire(500, 'different-epoch')).rejects.toThrow('Room epoch mismatch');
    leases.slice(0, -1).forEach(({ release }) => release());
    expect(registry.size()).toBe(1);
    leases.at(-1)!.release();
    leases.at(-1)!.release();
    expect(registry.size()).toBe(0);
    expect(routers[0]!.close).toHaveBeenCalledOnce();
  });

  it('does not honor onEmpty while a replacement join still holds a reservation', async () => {
    const registry = new RoomRegistry();
    const initial = await registry.acquire(500, 'epoch-1');
    const oldPeer = initial.room.addPeer(claims('old'), socket());
    initial.release();
    const replacement = await registry.acquire(500, 'epoch-1');

    replacement.room.removePeer(oldPeer.claims.session_id, oldPeer);
    expect(registry.get(500)).toBe(replacement.room);
    expect(routers[0]!.close).not.toHaveBeenCalled();

    const nextPeer = replacement.room.addPeer(claims('next'), socket());
    replacement.release();
    expect(registry.size()).toBe(1);
    replacement.room.removePeer(nextPeer.claims.session_id, nextPeer);
    expect(registry.size()).toBe(0);
    expect(routers[0]!.close).toHaveBeenCalledOnce();
  });
});
