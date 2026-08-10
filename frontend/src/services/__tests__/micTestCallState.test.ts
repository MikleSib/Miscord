import { describe, expect, it, vi } from 'vitest';

vi.mock('../../store/slices/voiceSlice', () => ({
  useVoiceStore: { getState: vi.fn() },
}));

import {
  restoreCallAfterMicTest,
  suspendCallForMicTest,
  type VoiceCallStateAdapter,
} from '../micTestCallState';

describe('microphone test call state', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('round-trips muted=%s deafened=%s', (muted, deafened) => {
    const state = {
      isConnected: true,
      isMuted: muted,
      isDeafened: deafened,
      wasMutedBeforeDeafen: muted,
      setMuteDeafenState: vi.fn((
        nextMuted: boolean,
        nextDeafened: boolean,
        nextWasMuted = nextMuted,
      ) => {
        state.isMuted = nextMuted;
        state.isDeafened = nextDeafened;
        state.wasMutedBeforeDeafen = nextWasMuted;
      }),
    };
    const adapter: VoiceCallStateAdapter = { getState: () => state };

    const saved = suspendCallForMicTest(adapter);
    expect([state.isMuted, state.isDeafened]).toEqual([true, true]);

    restoreCallAfterMicTest(saved, adapter);
    expect([state.isMuted, state.isDeafened]).toEqual([muted, deafened]);
    expect(state.setMuteDeafenState).toHaveBeenNthCalledWith(1, true, true, muted);
    expect(state.setMuteDeafenState).toHaveBeenNthCalledWith(2, muted, deafened, muted);
  });

  it('restores the hidden pre-deafen mute state', () => {
    const state = {
      isConnected: true,
      isMuted: true,
      isDeafened: true,
      wasMutedBeforeDeafen: false,
      setMuteDeafenState: vi.fn((
        muted: boolean,
        deafened: boolean,
        wasMutedBeforeDeafen = muted,
      ) => {
        state.isMuted = muted;
        state.isDeafened = deafened;
        state.wasMutedBeforeDeafen = wasMutedBeforeDeafen;
      }),
    };
    const adapter: VoiceCallStateAdapter = { getState: () => state };

    const saved = suspendCallForMicTest(adapter);
    restoreCallAfterMicTest(saved, adapter);

    expect(state).toMatchObject({
      isMuted: true,
      isDeafened: true,
      wasMutedBeforeDeafen: false,
    });
  });

  it('does not change state when there is no active call', () => {
    const setMuteDeafenState = vi.fn();
    const adapter: VoiceCallStateAdapter = {
      getState: () => ({
        isConnected: false,
        isMuted: false,
        isDeafened: false,
        wasMutedBeforeDeafen: false,
        setMuteDeafenState,
      }),
    };

    expect(suspendCallForMicTest(adapter)).toBeNull();
    restoreCallAfterMicTest({
      muted: false,
      deafened: false,
      wasMutedBeforeDeafen: false,
    }, adapter);
    expect(setMuteDeafenState).not.toHaveBeenCalled();
  });
});
