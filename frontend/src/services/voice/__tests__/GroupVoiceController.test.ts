import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload: any) => void>(),
  join: vi.fn(),
  leave: vi.fn(),
  capture: vi.fn(),
  initialize: vi.fn(),
  destroy: vi.fn(),
  destroyHook: null as (() => Promise<void>) | null,
  speechStart: null as (() => void) | null,
  speechEnd: null as (() => void) | null,
  inputLevel: null as ((dbfs: number) => void) | null,
  transports: [] as any[],
  events: [] as string[],
  setInputDeviceId: vi.fn(),
}));
vi.mock('../../audioProcessingService', () => ({
  audioProcessingService: {
    setOnSpeechStart: vi.fn((callback) => { mocks.speechStart = callback; }),
    setOnSpeechEnd: vi.fn((callback) => { mocks.speechEnd = callback; }),
    setOnInputLevel: vi.fn((callback) => { mocks.inputLevel = callback; }),
    initialize: mocks.initialize,
    destroy: mocks.destroy,
    setInputVolume: vi.fn(),
    setOutputVolume: vi.fn(),
    setMuted: vi.fn(),
    updateVADThresholds: vi.fn(),
    updateConfig: vi.fn(),
    getCurrentVolume: vi.fn(() => 0),
    getDiagnostics: vi.fn(() => ({ unsupportedConstraints: [] })),
  },
}));
vi.mock('../../voiceSettings', () => ({
  captureAudioStream: mocks.capture,
  getVoiceSettingsSnapshot: () => ({
    inputDeviceId: 'default', outputDeviceId: 'default', inputVolume: 100, outputVolume: 100,
    profile: 'isolation', inputMode: 'voice-activity', vadSensitivity: 50,
    autoDetectSensitivity: true, pttKey: 'Space', pttDelay: 0,
    processing: {
      noiseSuppression: true, noiseSuppressionEngine: 'deepfilternet3',
      echoCancellation: true, autoGainControl: false, voiceConditioning: true,
    },
  }),
  sensitivityToDbfs: vi.fn(() => -50),
}));
vi.mock('../../unifiedWebSocketService', () => ({
  default: {
    on: vi.fn((type, handler) => mocks.handlers.set(type, handler)),
    onUserJoinedVoice: vi.fn(), onUserLeftVoice: vi.fn(), onUserMuted: vi.fn(),
    onUserDeafened: vi.fn(), onUserSpeaking: vi.fn(), onScreenShareStarted: vi.fn(),
    onScreenShareStopped: vi.fn(), joinVoiceChannel: mocks.join, leaveVoiceChannel: mocks.leave, waitUntilReady: vi.fn(async () => undefined),
    updateSpeakingStatus: vi.fn(), updateMuteStatus: vi.fn(), updateDeafenStatus: vi.fn(),
    startScreenShare: vi.fn(), stopScreenShare: vi.fn(), send: vi.fn(() => true),
  },
}));
vi.mock('../sfuTransport', () => ({
  SfuTransport: class {
    setDeafened = vi.fn(async () => undefined);
    connect = vi.fn(async () => undefined);
    setMicrophoneMuted = vi.fn(async () => undefined);
    setSpeaking = vi.fn(async () => undefined);
    replaceMicrophoneTrack = vi.fn(async () => undefined);
    startScreenShare = vi.fn(async () => undefined);
    stopScreenShare = vi.fn(async () => undefined);
    close = vi.fn();
    onRemoteMedia = vi.fn(); onActiveSpeakers = vi.fn(); onFailure = vi.fn();
    clearScreenShareRequest = vi.fn();
    constructor() { mocks.transports.push(this); }
  },
}));
vi.mock('../../../store/store', () => ({ useAuthStore: { getState: () => ({ user: null }) } }));
vi.mock('../../../store/audioDeviceStore', () => ({
  useAudioDeviceStore: { getState: () => ({ setOutputVolume: vi.fn(), setInputDeviceId: mocks.setInputDeviceId }) },
}));
vi.mock('../../../store/screenShareSettingsStore', () => ({
  useScreenShareSettingsStore: { getState: () => ({}) },
}));
vi.mock('../../../lib/screenShareQuality', () => ({
  formatStreamQualityLabel: vi.fn(() => ''), getDisplayMediaVideoConstraints: vi.fn(),
  getElectronCaptureConstraints: vi.fn(), resolveQualitySettings: vi.fn(() => ({})),
}));
vi.mock('../../../lib/screenShareVideo', () => ({ SCREEN_SHARE_VIDEO_POOL_ID: 'pool' }));
vi.mock('../screenShareEvents', () => ({ dispatchScreenShareState: vi.fn() }));
vi.mock('../screenShareSounds', () => ({ playScreenShareSound: vi.fn() }));
import { GroupVoiceController } from '../GroupVoiceController';
function stream(label: string, deviceId?: string): MediaStream {
  const track = {
    id: label, kind: 'audio', stop: vi.fn(),
    ...(deviceId ? { getSettings: () => ({ deviceId }) } : {}),
  } as unknown as MediaStreamTrack;
  return {
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
    getTracks: () => [track],
  } as unknown as MediaStream;
}
function screenStream(label: string): MediaStream {
  const track = {
    id: label, kind: 'video', readyState: 'live', stop: vi.fn(), addEventListener: vi.fn(), contentHint: '',
  } as unknown as MediaStreamTrack;
  return {
    getAudioTracks: () => [], getVideoTracks: () => [track], getTracks: () => [track],
  } as unknown as MediaStream;
}
function emitJoined(channelId: number): void {
  mocks.handlers.get('voice_joined')?.({
    type: 'voice_joined', protocol_version: 1, channel_id: channelId,
    session_id: `session-${channelId}`, room_epoch: 'epoch', participants: [],
    self: { user_id: 1, is_muted: false, is_deafened: false },
    transport: { mode: 'sfu', ws_url: 'ws://media', ticket: `ticket-${channelId}` },
  });
}
async function connect(controller: GroupVoiceController, channelId: number): Promise<void> {
  const result = controller.joinVoiceChannel(channelId);
  await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledWith(channelId, expect.any(Boolean), expect.any(Boolean)));
  emitJoined(channelId);
  await result;
}
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('GroupVoiceController lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear(); mocks.transports.length = 0; mocks.events.length = 0;
    mocks.destroyHook = null; mocks.speechStart = null; mocks.speechEnd = null;
    let captureIndex = 0;
    mocks.capture.mockImplementation(async () => stream(`raw-${++captureIndex}`));
    mocks.initialize.mockImplementation(async () => {
      mocks.events.push(`initialize-${captureIndex}`);
      return stream(`processed-${captureIndex}`);
    });
    mocks.destroy.mockImplementation(async () => {
      mocks.events.push('destroy-start');
      await mocks.destroyHook?.();
      mocks.events.push('destroy-end');
    });
  });
  it('waits for old graph destruction before a rapid channel switch and clears stale speaking', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    mocks.speechStart?.();
    expect(controller.getIsSpeaking()).toBe(true);
    const gate = deferred();
    mocks.destroyHook = () => gate.promise;

    const switching = controller.joinVoiceChannel(2);
    await vi.waitFor(() => expect(mocks.events).toContain('destroy-start'));
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.join).toHaveBeenCalledTimes(1);

    gate.resolve(); mocks.destroyHook = null;
    await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledTimes(2));
    emitJoined(2);
    await switching;
    expect(mocks.events.indexOf('destroy-end')).toBeLessThan(mocks.events.indexOf('initialize-2'));
    expect(controller.getIsSpeaking()).toBe(false);
    expect(mocks.transports[1].setSpeaking).toHaveBeenCalledWith(false);
    await controller.leaveVoiceChannel();
  });
  it('serializes an unawaited leave followed by reconnect and resets public mute/deafen state', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    await controller.setMuted(true);
    await controller.setDeafened(true);
    const gate = deferred();
    mocks.destroyHook = () => gate.promise;

    const leaving = controller.leaveVoiceChannel();
    await vi.waitFor(() => expect(mocks.events).toContain('destroy-start'));
    const reconnecting = controller.joinVoiceChannel(2);
    expect(mocks.join).toHaveBeenCalledTimes(1);

    gate.resolve(); mocks.destroyHook = null;
    await leaving;
    await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledTimes(2));
    emitJoined(2);
    await reconnecting;
    expect(mocks.join).toHaveBeenLastCalledWith(2, false, false);
    expect(controller.getIsMuted()).toBe(false);
    expect(controller.getIsDeafened()).toBe(false);
    await controller.leaveVoiceChannel();
  });
  it('preserves deafen across an internal switch and reapplies it after connect', async () => {
    const controller = new GroupVoiceController();
    await controller.setDeafened(true);
    await connect(controller, 1);
    const switched = controller.joinVoiceChannel(2);
    await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledTimes(2));
    emitJoined(2);
    await switched;

    expect(mocks.transports[1].setDeafened.mock.calls).toEqual([[true], [true]]);
    expect(controller.getIsDeafened()).toBe(true);
    await controller.leaveVoiceChannel();
  });
  it.each(['capture', 'initialize'] as const)(
    'cancels and releases a mic switch when disconnect happens during %s',
    async (phase) => {
      const controller = new GroupVoiceController();
      await connect(controller, 1);
      const nextRaw = stream(`raw-${phase}`);
      const nextProcessed = stream(`processed-${phase}`);
      const gate = deferred<MediaStream>();
      if (phase === 'capture') mocks.capture.mockImplementationOnce(() => gate.promise);
      else {
        mocks.capture.mockResolvedValueOnce(nextRaw);
        mocks.initialize.mockImplementationOnce(() => gate.promise);
      }

      const switching = controller.switchInputDevice(`mic-${phase}`);
      const rejected = expect(switching).rejects.toThrow(
        phase === 'capture' ? 'superseded' : 'Voice transport changed',
      );
      await vi.waitFor(() => expect(
        phase === 'capture' ? mocks.capture : mocks.initialize,
      ).toHaveBeenCalledTimes(2));
      const leaving = controller.leaveVoiceChannel();
      gate.resolve(phase === 'capture' ? nextRaw : nextProcessed);

      await rejected;
      await leaving;
      expect(nextRaw.getTracks()[0]!.stop).toHaveBeenCalledOnce();
      expect(mocks.transports[0].replaceMicrophoneTrack).toHaveBeenCalledTimes(phase === 'capture' ? 0 : 1);
    },
  );
  it('keeps the latest concurrent mic request when B resolves before A', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const rawA = stream('raw-A');
    const rawB = stream('raw-B');
    const processedB = stream('processed-B');
    const captureA = deferred<MediaStream>();
    const captureB = deferred<MediaStream>();
    mocks.capture.mockImplementation((_processing, deviceId) => {
      if (deviceId === 'mic-A') return captureA.promise;
      if (deviceId === 'mic-B') return captureB.promise;
      throw new Error(`unexpected device ${deviceId}`);
    });
    mocks.initialize.mockResolvedValueOnce(processedB);

    const switchA = controller.switchInputDevice('mic-A');
    const rejectedA = expect(switchA).rejects.toThrow('superseded');
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledWith(
      expect.anything(), 'mic-A', { strictDevice: true },
    ));
    const switchB = controller.switchInputDevice('mic-B');
    captureB.resolve(rawB);
    captureA.resolve(rawA);

    await rejectedA;
    await switchB;
    expect(rawA.getTracks()[0]!.stop).toHaveBeenCalledOnce();
    expect(mocks.transports[0].replaceMicrophoneTrack).toHaveBeenCalledTimes(2);
    expect(mocks.transports[0].replaceMicrophoneTrack)
      .toHaveBeenCalledWith(processedB.getAudioTracks()[0]);
    await controller.leaveVoiceChannel();
  });
  it('keeps the old graph when A is superseded before initialize and B capture fails', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const rawA = stream('raw-A-stale');
    const captureA = deferred<MediaStream>();
    mocks.capture.mockImplementation((_processing, deviceId) => {
      if (deviceId === 'mic-A') return captureA.promise;
      if (deviceId === 'mic-B') throw new Error('mic-B capture failed');
      throw new Error(`unexpected device ${deviceId}`);
    });

    const switchA = controller.switchInputDevice('mic-A');
    const rejectedA = expect(switchA).rejects.toThrow('superseded');
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledWith(
      expect.anything(), 'mic-A', { strictDevice: true },
    ));
    const switchB = controller.switchInputDevice('mic-B');
    const rejectedB = expect(switchB).rejects.toThrow('mic-B capture failed');
    captureA.resolve(rawA);

    await rejectedA;
    await rejectedB;
    expect(rawA.getTracks()[0]!.stop).toHaveBeenCalledOnce();
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(mocks.transports[0].replaceMicrophoneTrack).not.toHaveBeenCalled();
    await controller.leaveVoiceChannel();
  });
  it('keeps A as a dry bridge when B supersedes its destructive initialize and then fails capture', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const rawA = stream('raw-A-bridge');
    const processedA = stream('processed-A-stale');
    const initializeA = deferred<MediaStream>();
    mocks.capture.mockImplementation((_processing, deviceId) => {
      if (deviceId === 'mic-A') return Promise.resolve(rawA);
      if (deviceId === 'mic-B') throw new Error('mic-B capture failed');
      throw new Error(`unexpected device ${deviceId}`);
    });
    mocks.initialize.mockImplementationOnce(() => initializeA.promise);

    const switchA = controller.switchInputDevice('mic-A');
    const rejectedA = expect(switchA).rejects.toThrow('superseded');
    await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(2));
    expect(mocks.transports[0].replaceMicrophoneTrack)
      .toHaveBeenCalledWith(rawA.getAudioTracks()[0]);
    const switchB = controller.switchInputDevice('mic-B');
    const rejectedB = expect(switchB).rejects.toThrow('mic-B capture failed');
    initializeA.resolve(processedA);

    await rejectedA;
    await rejectedB;
    expect(controller.getAppliedInputDeviceId()).toBe('mic-A');
    expect(rawA.getTracks()[0]!.stop).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(mocks.transports[0].replaceMicrophoneTrack).toHaveBeenCalledTimes(2);
    expect(mocks.transports[0].replaceMicrophoneTrack)
      .toHaveBeenLastCalledWith(processedA.getAudioTracks()[0]);
    await controller.leaveVoiceChannel();
  });
  it('keeps the old producer when the raw bridge cannot be installed', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const candidate = stream('raw-rejected-bridge');
    mocks.capture.mockResolvedValueOnce(candidate);
    mocks.transports[0].replaceMicrophoneTrack.mockRejectedValueOnce(new Error('replace raw failed'));

    await expect(controller.switchInputDevice('mic-broken')).rejects.toThrow('replace raw failed');
    expect(candidate.getTracks()[0]!.stop).toHaveBeenCalledOnce();
    expect(controller.getAppliedInputDeviceId()).toBe('default');
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    await controller.leaveVoiceChannel();
  });
  it('rejects an unexpected microphone before it can replace the live producer', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const unexpected = stream('unexpected-raw', 'different-mic');
    mocks.capture.mockResolvedValueOnce(unexpected);

    await expect(controller.switchInputDevice('requested-mic')).rejects.toThrow('другой микрофон');
    expect(unexpected.getTracks()[0]!.stop).toHaveBeenCalledOnce();
    expect(mocks.transports[0].replaceMicrophoneTrack).not.toHaveBeenCalled();
    expect(controller.getAppliedInputDeviceId()).toBe('default');
    await controller.leaveVoiceChannel();
  });
  it('keeps the new dry bridge when replacing it with processed audio fails', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const candidate = stream('raw-processed-failure');
    const processed = stream('processed-failure');
    mocks.capture.mockResolvedValueOnce(candidate);
    mocks.initialize.mockResolvedValueOnce(processed);
    mocks.transports[0].replaceMicrophoneTrack
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('replace processed failed'));

    await expect(controller.switchInputDevice('mic-dry')).rejects.toThrow('replace processed failed');
    expect(candidate.getTracks()[0]!.stop).not.toHaveBeenCalled();
    expect(controller.getAppliedInputDeviceId()).toBe('mic-dry');
    expect(mocks.transports[0].replaceMicrophoneTrack).toHaveBeenNthCalledWith(
      1,
      candidate.getAudioTracks()[0],
    );
    await controller.leaveVoiceChannel();
  });
  it('recaptures the latest device selected while the initial join capture is pending', async () => {
    const controller = new GroupVoiceController();
    const rawA = stream('join-raw-A');
    const rawB = stream('join-raw-B');
    const processedB = stream('join-processed-B');
    const captureA = deferred<MediaStream>();
    mocks.capture.mockImplementation((_processing, deviceId) => {
      if (deviceId === 'default') return captureA.promise;
      if (deviceId === 'mic-B') return Promise.resolve(rawB);
      throw new Error(`unexpected device ${deviceId}`);
    });
    mocks.initialize.mockResolvedValueOnce(processedB);

    const joining = controller.joinVoiceChannel(1);
    await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledWith(1, false, false)); emitJoined(1);
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledWith(expect.anything(), 'default'));
    const selecting = controller.switchInputDevice('mic-B');
    captureA.resolve(rawA);

    await selecting;
    await joining;
    expect(rawA.getTracks()[0]!.stop).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(expect.anything(), 'mic-B');
    expect(mocks.transports[0].connect).toHaveBeenCalledWith(
      'ws://media',
      'ticket-1',
      processedB.getAudioTracks()[0],
      false, { userId: 1, sessionId: 'session-1' },
    );
    await controller.leaveVoiceChannel();
  });
  it('fails a pending join selection without persisting a microphone that never opened', async () => {
    const controller = new GroupVoiceController();
    const rawA = stream('join-stale-A');
    const captureA = deferred<MediaStream>();
    mocks.capture.mockImplementation((_processing, deviceId) => {
      if (deviceId === 'default') return captureA.promise;
      if (deviceId === 'mic-B') throw new Error('join mic-B failed');
      throw new Error(`unexpected device ${deviceId}`);
    });

    const joining = controller.joinVoiceChannel(1);
    await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledWith(1, false, false)); emitJoined(1);
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledWith(expect.anything(), 'default'));
    const selecting = controller.switchInputDevice('mic-B');
    captureA.resolve(rawA);

    await expect(selecting).rejects.toThrow('join mic-B failed');
    await expect(joining).rejects.toThrow('join mic-B failed');
    expect(rawA.getTracks()[0]!.stop).toHaveBeenCalledOnce();
    expect(controller.getAppliedInputDeviceId()).toBe('default');
  });
  it('reconciles a stale persisted join device to the microphone actually captured', async () => {
    const controller = new GroupVoiceController();
    await controller.switchInputDevice('missing-old-mic');
    const actualRaw = stream('actual-raw', 'actual-default-mic');
    mocks.capture.mockResolvedValueOnce(actualRaw);

    await connect(controller, 1);

    expect(mocks.capture).toHaveBeenCalledWith(expect.anything(), 'missing-old-mic');
    expect(controller.getAppliedInputDeviceId()).toBe('actual-default-mic');
    expect(mocks.setInputDeviceId).toHaveBeenCalledWith('actual-default-mic');
    await controller.leaveVoiceChannel();
  });
  it('keeps latest mute and VAD settings while a microphone switch is pending', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const raw = stream('raw-settings');
    const processed = stream('processed-settings');
    const capture = deferred<MediaStream>();
    mocks.capture.mockImplementationOnce(() => capture.promise);
    mocks.initialize.mockResolvedValueOnce(processed);

    const switching = controller.switchInputDevice('mic-settings');
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(2));
    controller.setInputMode('push-to-talk');
    controller.setAutoDetectSensitivity(false); controller.setVADSensitivity(73);
    await controller.setMuted(true);
    await controller.setMuted(false);
    capture.resolve(raw);
    await switching;

    expect(mocks.initialize).toHaveBeenLastCalledWith(raw, expect.objectContaining({
      speechProbabilityThreshold: 0.73,
    }));
    expect(controller.getDiagnostics().vadThresholdDbfs).toBe(-50);
    expect(mocks.transports[0].replaceMicrophoneTrack).toHaveBeenCalledTimes(2);
    await controller.leaveVoiceChannel();
  });
  it('closes media, signals leave and stops the bridged microphone before a pending initialize resolves', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const raw = stream('raw-private');
    const processed = stream('processed-private');
    const initialize = deferred<MediaStream>();
    mocks.capture.mockResolvedValueOnce(raw);
    mocks.initialize.mockImplementationOnce(() => initialize.promise);
    const switching = controller.switchInputDevice('mic-private');
    const rejectedSwitch = expect(switching).rejects.toThrow('Voice transport changed');
    await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(2));

    const leaving = controller.leaveVoiceChannel();
    expect(mocks.transports[0].close).toHaveBeenCalledOnce();
    expect(mocks.leave).toHaveBeenCalledWith(1);
    expect(raw.getTracks()[0]!.stop).toHaveBeenCalledOnce();
    initialize.resolve(processed);

    await rejectedSwitch;
    await leaving;
  });
  it('stops a late getUserMedia result exactly once after disconnect', async () => {
    const controller = new GroupVoiceController();
    const raw = stream('late-join-capture');
    const capture = deferred<MediaStream>();
    mocks.capture.mockImplementationOnce(() => capture.promise);
    const joining = controller.joinVoiceChannel(1);
    await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledWith(1, false, false)); emitJoined(1);
    const rejectedJoin = expect(joining).rejects.toThrow();
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    const leaving = controller.leaveVoiceChannel();
    capture.resolve(raw);

    await rejectedJoin;
    await leaving;
    expect(raw.getTracks()[0]!.stop).toHaveBeenCalledOnce();
  });
  it('rolls back a failed monitor pause and does not leave the producer gated', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    mocks.transports[0].setMicrophoneMuted.mockRejectedValueOnce(new Error('pause failed'));

    await expect(controller.beginMicrophoneMonitor()).rejects.toThrow('pause failed');
    expect(mocks.transports[0].setMicrophoneMuted.mock.calls.slice(-2)).toEqual([[true], [false]]);
    await controller.leaveVoiceChannel();
  });
  it('invalidates a pending monitor pause before leave and reconnect', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const pause = deferred();
    mocks.transports[0].setMicrophoneMuted.mockImplementationOnce(() => pause.promise);
    const monitoring = controller.beginMicrophoneMonitor();
    await vi.waitFor(() => expect(mocks.transports[0].setMicrophoneMuted).toHaveBeenLastCalledWith(true));
    const leaving = controller.leaveVoiceChannel();
    pause.resolve();

    expect(await monitoring).toBeNull();
    await leaving;
    await connect(controller, 2);
    expect(mocks.transports[1].setMicrophoneMuted).toHaveBeenLastCalledWith(false);
    await controller.leaveVoiceChannel();
  });
  it('waits for an in-progress join before starting the shared microphone monitor', async () => {
    const controller = new GroupVoiceController();
    const raw = stream('join-monitor-raw');
    const processed = stream('join-monitor-processed');
    const capture = deferred<MediaStream>();
    mocks.capture.mockImplementationOnce(() => capture.promise);
    mocks.initialize.mockResolvedValueOnce(processed);
    const joining = controller.joinVoiceChannel(1);
    const monitoring = controller.beginMicrophoneMonitor();
    await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledWith(1, false, false)); emitJoined(1);
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    capture.resolve(raw);

    await joining;
    expect(await monitoring).toBe(processed);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.transports[0].connect).toHaveBeenCalledWith(
      'ws://media', 'ticket-1', processed.getAudioTracks()[0], true, { userId: 1, sessionId: 'session-1' },
    );
    expect(mocks.transports[0].setMicrophoneMuted).toHaveBeenLastCalledWith(true);
    await controller.endMicrophoneMonitor();
    await controller.leaveVoiceChannel();
  });
  it('creates the first producer gated when push-to-talk is inactive', async () => {
    const controller = new GroupVoiceController();
    const raw = stream('ptt-join-raw');
    const capture = deferred<MediaStream>();
    mocks.capture.mockImplementationOnce(() => capture.promise);
    const joining = controller.joinVoiceChannel(1);
    await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledWith(1, false, false)); emitJoined(1);
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    controller.setInputMode('push-to-talk');
    capture.resolve(raw);
    await joining;

    expect(mocks.transports[0].connect).toHaveBeenCalledWith(
      'ws://media', 'ticket-1', expect.anything(), true, { userId: 1, sessionId: 'session-1' },
    );
    expect(mocks.transports[0].setMicrophoneMuted).toHaveBeenLastCalledWith(true);
    await controller.leaveVoiceChannel();
  });
  it('stops screen tracks synchronously before a slow SFU stop finishes', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const screen = stream('screen-private');
    const stop = deferred();
    mocks.transports[0].stopScreenShare = vi.fn(() => stop.promise);
    (controller as any).screenStream = screen;
    (controller as any).isScreenSharing = true;

    controller.stopScreenShare();
    expect(screen.getTracks()[0]!.stop).toHaveBeenCalledOnce();
    stop.resolve();
    await vi.waitFor(() => expect(mocks.transports[0].stopScreenShare).toHaveBeenCalledOnce());
    await controller.leaveVoiceChannel();
  });
  it('does not publish a picker result into a channel selected while capture was pending', async () => {
    const controller = new GroupVoiceController();
    await connect(controller, 1);
    const candidate = screenStream('stale-picker');
    const capture = deferred<MediaStream>();
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: vi.fn(() => capture.promise) },
    });
    const starting = controller.startScreenShare();
    await vi.waitFor(() => expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledOnce());
    const switching = controller.joinVoiceChannel(2);
    await vi.waitFor(() => expect(mocks.join).toHaveBeenCalledTimes(2));
    emitJoined(2);
    await switching;
    capture.resolve(candidate);

    expect(await starting).toBe(false);
    expect(candidate.getTracks()[0]!.stop).toHaveBeenCalledOnce();
    expect(mocks.transports[0].startScreenShare).not.toHaveBeenCalled();
    expect(mocks.transports[1].startScreenShare).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    await controller.leaveVoiceChannel();
  });
});
