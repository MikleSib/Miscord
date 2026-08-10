import { describe, expect, it, vi } from 'vitest';

import { ActivityRefreshQueue } from './activityRefreshQueue.js';

describe('ActivityRefreshQueue', () => {
  it('coalesces one cross-microtask burst into one refresh with the newest priority', async () => {
    const refresh = vi.fn(async () => undefined);
    const queue = new ActivityRefreshQueue(refresh);

    const pending: Promise<void>[] = [];
    for (let index = 0; index < 100; index += 1) {
      await Promise.resolve();
      pending.push(queue.request(index % 2 === 0, `producer-${index}`));
    }
    await Promise.all(pending);

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(true, 'producer-99');
  });

  it('runs and awaits a request arriving between drain completion and cleanup', async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const refresh = vi.fn()
      .mockImplementationOnce(() => firstGate)
      .mockImplementationOnce(() => secondGate);
    const queue = new ActivityRefreshQueue(refresh);
    const first = queue.request();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    releaseFirst();
    let second!: Promise<void>;
    await new Promise<void>((resolve) => queueMicrotask(() => {
      second = queue.request();
      resolve();
    }));
    await first;
    let secondResolved = false;
    void second.then(() => { secondResolved = true; });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(secondResolved).toBe(false);

    releaseSecond();
    await second;
    expect(secondResolved).toBe(true);
  });
});
