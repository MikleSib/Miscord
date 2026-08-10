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
});
