import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  joinVoiceChannel: vi.fn<() => Promise<void>>(),
  leaveVoiceChannel: vi.fn(),
  playLeaveSound: vi.fn(),
}));

vi.mock('../../../services/optimizedVoiceService', () => ({
  default: {
    joinVoiceChannel: mocks.joinVoiceChannel,
    leaveVoiceChannel: mocks.leaveVoiceChannel,
    onParticipantJoined: vi.fn(),
    onParticipantLeft: vi.fn(),
    onSpeakingChanged: vi.fn(),
    onParticipantsReceived: vi.fn(),
    onSignalingJoined: vi.fn(),
    onParticipantStatusChanged: vi.fn(),
    onRemoteStream: vi.fn(),
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    setMuted: vi.fn(),
    setDeafened: vi.fn(),
  },
}));

vi.mock('../../../services/unifiedWebSocketService', () => ({
  default: {
    isConnected: () => true,
    waitUntilReady: () => Promise.resolve(),
    connect: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('../../../services/soundService', () => ({
  default: {
    playJoinSound: vi.fn(),
    playLeaveSound: mocks.playLeaveSound,
    playMicToggleSound: vi.fn(),
  },
}));

vi.mock('../../store', () => ({
  useAuthStore: {
    getState: () => ({
      token: 'test-token',
      user: { id: 7, username: 'test-user', display_name: 'Test user' },
    }),
  },
}));

import { useOptimizedVoiceStore } from '../optimizedVoiceSlice';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  mocks.joinVoiceChannel.mockReset();
  mocks.leaveVoiceChannel.mockReset();
  mocks.playLeaveSound.mockReset();
  useOptimizedVoiceStore.setState({
    isConnected: false,
    isConnecting: false,
    currentVoiceChannelId: null,
    participants: [],
    localStream: null,
    remoteStream: null,
    isMuted: false,
    isDeafened: false,
    wasMutedBeforeDeafen: false,
    error: null,
    speakingUsers: {},
  });
});

describe('optimized voice disconnect lifecycle', () => {
  it('ignores a late media rejection after a voluntary disconnect', async () => {
    const join = deferred();
    mocks.joinVoiceChannel.mockReturnValueOnce(join.promise);

    const connecting = useOptimizedVoiceStore.getState().connectToVoiceChannel(123);
    await vi.waitFor(() => expect(mocks.joinVoiceChannel).toHaveBeenCalledWith(123));

    useOptimizedVoiceStore.getState().disconnectFromVoiceChannel();
    join.reject(new Error('Media client closed'));
    await connecting;

    expect(useOptimizedVoiceStore.getState()).toMatchObject({
      currentVoiceChannelId: null,
      isConnected: false,
      isConnecting: false,
      error: null,
    });
    expect(mocks.leaveVoiceChannel).toHaveBeenCalledOnce();
  });

  it('still exposes a genuine failure from the active connection attempt', async () => {
    mocks.joinVoiceChannel.mockRejectedValueOnce(new Error('Media service unavailable'));

    await useOptimizedVoiceStore.getState().connectToVoiceChannel(456);

    expect(useOptimizedVoiceStore.getState()).toMatchObject({
      currentVoiceChannelId: null,
      isConnected: false,
      isConnecting: false,
      error: 'Media service unavailable',
    });
  });
});
