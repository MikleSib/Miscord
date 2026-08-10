import { describe, expect, it, vi } from 'vitest';

import { SessionIdentifyQueue } from './sessionIdentifyQueue.js';

describe('SessionIdentifyQueue', () => {
  it('serializes setup for the same session', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const queue = new SessionIdentifyQueue();
    const first = queue.run('same', async () => {
      events.push('first-start');
      await gate;
      events.push('first-end');
      return 1;
    });
    const second = queue.run('same', async () => {
      events.push('second');
      return 2;
    });

    await vi.waitFor(() => expect(events).toEqual(['first-start']));
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(['first-start', 'first-end', 'second']);
  });

  it('does not serialize different sessions', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queue = new SessionIdentifyQueue();
    const first = queue.run('a', () => gate);
    const other = vi.fn(async () => 'ready');

    await expect(queue.run('b', other)).resolves.toBe('ready');
    expect(other).toHaveBeenCalledOnce();
    release();
    await first;
  });

  it('keeps a newer tail when an older task cleanup runs', async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const queue = new SessionIdentifyQueue();
    const first = queue.run('same', () => firstGate);
    const secondStarted = vi.fn();
    const second = queue.run('same', async () => {
      secondStarted();
      await secondGate;
    });

    releaseFirst();
    await first;
    await vi.waitFor(() => expect(secondStarted).toHaveBeenCalledOnce());
    expect(queue.size()).toBe(1);
    releaseSecond();
    await second;
    await vi.waitFor(() => expect(queue.size()).toBe(0));
  });

  it('continues after failure and removes the final key', async () => {
    const queue = new SessionIdentifyQueue();
    const failed = queue.run('same', async () => { throw new Error('failed'); });
    const recovered = queue.run('same', async () => 'ok');

    await expect(failed).rejects.toThrow('failed');
    await expect(recovered).resolves.toBe('ok');
    await vi.waitFor(() => expect(queue.size()).toBe(0));
  });
});
