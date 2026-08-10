import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { mediaCodecs, WorkerPool } from './workerPool.js';

class FakeRouter extends EventEmitter {
  closed = false;

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('@close');
  }
}

function poolWithWorkers(count: number): {
  pool: WorkerPool;
  createRouter: Array<ReturnType<typeof vi.fn>>;
  roomLoads: () => number[];
} {
  const pool = new WorkerPool();
  const createRouter = Array.from({ length: count }, () => vi.fn(async () => {
    await Promise.resolve();
    return new FakeRouter();
  }));
  const slots = createRouter.map((create, index) => ({
    worker: { pid: 100 + index, closed: false, createRouter: create },
    webRtcServer: { closed: false },
    rooms: 0,
    consumers: 0,
    port: 20_000 + index,
  }));
  (pool as unknown as { slots: typeof slots }).slots = slots;
  return { pool, createRouter, roomLoads: () => slots.map((slot) => slot.rooms) };
}

describe('voice media codec capabilities', () => {
  it('keeps the router Opus capability source-neutral', () => {
    const opus = mediaCodecs.find((codec) => codec.mimeType.toLowerCase() === 'audio/opus');

    expect(opus).toMatchObject({
      clockRate: 48_000,
      channels: 2,
    });
    // Source-specific fmtp belongs on each producer. Keeping this exact also
    // prevents the router from silently capping bot/music or screen audio.
    expect(opus?.parameters).toEqual({ useinbandfec: 1 });
  });
});

describe('worker room reservations', () => {
  it('balances thirty concurrent router creations across three workers', async () => {
    const { pool, createRouter, roomLoads } = poolWithWorkers(3);

    const created = await Promise.all(Array.from({ length: 30 }, () => pool.createRouter()));

    expect(createRouter.map((create) => create.mock.calls.length)).toEqual([10, 10, 10]);
    expect(roomLoads()).toEqual([10, 10, 10]);
    created.forEach(({ router }) => router.close());
    expect(roomLoads()).toEqual([0, 0, 0]);
  });

  it('rolls a reservation back when router creation rejects', async () => {
    const { pool, createRouter, roomLoads } = poolWithWorkers(1);
    createRouter[0]!.mockRejectedValueOnce(new Error('router failed'));

    await expect(pool.createRouter()).rejects.toThrow('router failed');

    expect(roomLoads()).toEqual([0]);
    const { router } = await pool.createRouter();
    expect(roomLoads()).toEqual([1]);
    router.close();
    expect(roomLoads()).toEqual([0]);
  });

  it('releases a successful reservation exactly once when a router closes', async () => {
    const { pool, roomLoads } = poolWithWorkers(1);
    const { router } = await pool.createRouter();

    router.close();
    router.emit('@close');

    expect(roomLoads()).toEqual([0]);
  });
});
