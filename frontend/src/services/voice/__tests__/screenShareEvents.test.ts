import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchScreenShareState } from '../screenShareEvents';

class FakeCustomEvent {
  constructor(readonly type: string, readonly init: { detail: unknown }) {}
  get detail(): unknown { return this.init.detail; }
}

afterEach(() => vi.unstubAllGlobals());

describe('screen share UI events', () => {
  it.each([
    [true, 'screen_share_start'],
    [false, 'screen_share_stop'],
  ] as const)('bridges SFU state %s to %s', (sharing, expectedType) => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('CustomEvent', FakeCustomEvent);

    dispatchScreenShareState({
      user_id: 42,
      username: 'streamer',
      is_sharing_screen: sharing,
    });

    expect(dispatchEvent).toHaveBeenCalledOnce();
    const event = dispatchEvent.mock.calls[0]?.[0] as FakeCustomEvent;
    expect(event.type).toBe(expectedType);
    expect(event.detail).toMatchObject({ user_id: 42, is_sharing_screen: sharing });
  });
});
