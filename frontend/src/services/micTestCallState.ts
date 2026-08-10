import { useVoiceStore } from '../store/slices/voiceSlice';

export interface SavedMicTestCallState {
  muted: boolean;
  deafened: boolean;
  wasMutedBeforeDeafen: boolean;
}

interface VoiceCallState {
  isConnected: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  wasMutedBeforeDeafen: boolean;
  setMuteDeafenState: (
    muted: boolean,
    deafened: boolean,
    wasMutedBeforeDeafen?: boolean,
  ) => void;
}

export interface VoiceCallStateAdapter {
  getState: () => VoiceCallState;
}

const defaultAdapter: VoiceCallStateAdapter = useVoiceStore;

export function suspendCallForMicTest(
  adapter: VoiceCallStateAdapter = defaultAdapter,
): SavedMicTestCallState | null {
  const current = adapter.getState();
  if (!current.isConnected) return null;

  const saved = {
    muted: current.isMuted,
    deafened: current.isDeafened,
    wasMutedBeforeDeafen: current.wasMutedBeforeDeafen,
  };
  current.setMuteDeafenState(true, true, current.wasMutedBeforeDeafen);
  return saved;
}

export function restoreCallAfterMicTest(
  saved: SavedMicTestCallState | null,
  adapter: VoiceCallStateAdapter = defaultAdapter,
): void {
  if (!saved) return;
  const current = adapter.getState();
  if (!current.isConnected) return;
  current.setMuteDeafenState(
    saved.muted,
    saved.deafened,
    saved.wasMutedBeforeDeafen,
  );
}
