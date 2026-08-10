import { describe, expect, it, vi } from 'vitest';

import { GroupVoiceOutputSwitch } from '../groupVoiceOutputSwitch';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('GroupVoiceOutputSwitch', () => {
  it('reapplies the latest sink when an older request finishes last', async () => {
    const switching = new GroupVoiceOutputSwitch();
    const sinkA = deferred();
    const sinkB = deferred();
    let actualSink = 'default';
    const setSinkId = vi.fn((deviceId: string) => {
      const operation = setSinkId.mock.calls.length === 1 ? sinkA : sinkB;
      return operation.promise.then(() => { actualSink = deviceId; });
    });
    const audio = { setSinkId } as unknown as HTMLAudioElement;

    const first = switching.apply({ deviceId: 'sink-A', elements: [audio], onUnsupported: vi.fn() });
    const second = switching.apply({ deviceId: 'sink-B', elements: [audio], onUnsupported: vi.fn() });
    sinkB.resolve();
    await second;
    expect(actualSink).toBe('sink-B');
    sinkA.resolve();
    await vi.waitFor(() => expect(setSinkId).toHaveBeenCalledTimes(3));
    // The stale A operation performs one corrective B call. Reuse the resolved B gate.
    await first;
    expect(setSinkId).toHaveBeenLastCalledWith('sink-B');
    expect(actualSink).toBe('sink-B');
  });
});
