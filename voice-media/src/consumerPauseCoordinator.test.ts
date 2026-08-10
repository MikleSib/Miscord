import { describe, expect, it, vi } from 'vitest';

import { ConsumerPauseCoordinator } from './consumerPauseCoordinator.js';

describe('ConsumerPauseCoordinator cleanup races', () => {
  it('does not commit a transition that completes after unregister', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const consumer = {
      paused: false,
      appData: { userPaused: false, activityPaused: false },
      pause: vi.fn(() => gate),
      resume: vi.fn(async () => undefined),
    };
    const coordinator = new ConsumerPauseCoordinator();
    coordinator.register(consumer as never);
    const pending = coordinator.setActivityPaused(consumer as never, true);
    await vi.waitFor(() => expect(consumer.pause).toHaveBeenCalledOnce());

    coordinator.unregister(consumer as never);
    release();
    await pending;
    await Promise.resolve();

    expect(consumer.appData.activityPaused).toBe(false);
  });

  it('keeps a consumer paused while either user, activity, or server gate is active', async () => {
    const consumer = {
      paused: false,
      appData: { userPaused: false, activityPaused: false, serverPaused: false },
      pause: vi.fn(async function (this: { paused: boolean }) { this.paused = true; }),
      resume: vi.fn(async function (this: { paused: boolean }) { this.paused = false; }),
    };
    const coordinator = new ConsumerPauseCoordinator();
    coordinator.register(consumer as never);

    await coordinator.setServerPaused(consumer as never, true);
    await coordinator.setUserPaused(consumer as never, true);
    await coordinator.setServerPaused(consumer as never, false);
    expect(consumer.resume).not.toHaveBeenCalled();

    await coordinator.setUserPaused(consumer as never, false);
    expect(consumer.resume).toHaveBeenCalledOnce();
    expect(consumer.appData).toEqual({
      userPaused: false,
      activityPaused: false,
      serverPaused: false,
    });
  });
});
