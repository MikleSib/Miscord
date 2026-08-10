import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  beginMicrophoneMonitor: vi.fn(),
  endMicrophoneMonitor: vi.fn(),
  getDiagnostics: vi.fn(),
  captureAudioStream: vi.fn(),
  AudioProcessingService: vi.fn(),
}));

vi.mock('../voice/GroupVoiceController', () => ({
  groupVoiceController: {
    beginMicrophoneMonitor: mocks.beginMicrophoneMonitor,
    endMicrophoneMonitor: mocks.endMicrophoneMonitor,
    getDiagnostics: mocks.getDiagnostics,
  },
}));
vi.mock('../voiceSettings', () => ({
  captureAudioStream: mocks.captureAudioStream,
  sensitivityToDbfs: (sensitivity: number) => sensitivity - 100,
}));
vi.mock('../audioProcessingService', () => ({
  AudioProcessingService: mocks.AudioProcessingService,
}));

import { MicTestSession } from '../micTestService';

class FakeAudioContext {
  static sampleAmplitude = 0;
  static gains: Array<{
    value: number;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
    setTargetAtTime: ReturnType<typeof vi.fn>;
  }> = [];
  state: AudioContextState = 'running';
  currentTime = 0;
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => ({
    fftSize: 1024,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData: vi.fn((samples: Float32Array) =>
      samples.fill(FakeAudioContext.sampleAmplitude)),
  }));
  createMediaStreamDestination = vi.fn(() => ({ stream: { id: 'monitor' } }));
  createGain = vi.fn(() => {
    const gain = {
      value: 1,
      cancelScheduledValues: vi.fn(),
      setTargetAtTime: vi.fn(),
    };
    FakeAudioContext.gains.push(gain);
    return { gain, connect: vi.fn() };
  });
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
}

class FakeAudio {
  autoplay = false;
  volume = 1;
  srcObject: MediaProvider | null = null;
  play = vi.fn(async () => undefined);
  pause = vi.fn();
}

describe('MicTestSession in an active call', () => {
  const options = () => ({
    inputVolume: 100,
    outputVolume: 80,
    processing: {
      noiseSuppression: true,
      noiseSuppressionEngine: 'deepfilternet3' as const,
      echoCancellation: true,
      autoGainControl: false,
      voiceConditioning: true,
    },
    inputMode: 'voice-activity' as const,
    vadSensitivity: 50,
    autoDetectSensitivity: false,
    onLevel: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    FakeAudioContext.sampleAmplitude = 0;
    FakeAudioContext.gains = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('monitors the existing processed stream instead of starting a second DFN3', async () => {
    const liveStream = {} as MediaStream;
    mocks.beginMicrophoneMonitor.mockResolvedValue(liveStream);
    mocks.endMicrophoneMonitor.mockResolvedValue(undefined);
    mocks.getDiagnostics.mockReturnValue({
      status: 'active',
      message: 'DeepFilterNet3 активен',
      activeEngine: 'deepfilternet3',
    });
    const onRuntimeStatus = vi.fn();
    const session = new MicTestSession();

    await session.start({
      ...options(),
      onRuntimeStatus,
    });

    expect(mocks.captureAudioStream).not.toHaveBeenCalled();
    expect(mocks.AudioProcessingService).not.toHaveBeenCalled();
    expect(onRuntimeStatus).toHaveBeenCalledWith(
      'active',
      'DeepFilterNet3 активен',
      'deepfilternet3',
    );

    session.stop();
    await vi.waitFor(() => expect(mocks.endMicrophoneMonitor).toHaveBeenCalled());
  });

  it('serializes overlapping starts so an old lease cannot end a new monitor', async () => {
    let releaseFirst!: (stream: MediaStream) => void;
    const firstMonitor = new Promise<MediaStream>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStream = {} as MediaStream;
    const secondStream = {} as MediaStream;
    mocks.beginMicrophoneMonitor
      .mockImplementationOnce(() => firstMonitor)
      .mockResolvedValueOnce(secondStream);
    mocks.endMicrophoneMonitor.mockResolvedValue(undefined);
    mocks.getDiagnostics.mockReturnValue({
      status: 'active',
      message: 'DeepFilterNet3 активен',
      activeEngine: 'deepfilternet3',
    });
    const session = new MicTestSession();

    const oldStart = session.start(options());
    await vi.waitFor(() => {
      expect(mocks.beginMicrophoneMonitor).toHaveBeenCalledTimes(1);
    });
    const newStart = session.start(options());
    await Promise.resolve();
    expect(mocks.beginMicrophoneMonitor).toHaveBeenCalledTimes(1);

    releaseFirst(firstStream);
    await oldStart;
    await newStart;

    expect(mocks.beginMicrophoneMonitor).toHaveBeenCalledTimes(2);
    expect(mocks.endMicrophoneMonitor).toHaveBeenCalledTimes(1);
    expect(mocks.endMicrophoneMonitor.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.beginMicrophoneMonitor.mock.invocationCallOrder[1],
    );

    session.stop();
    await vi.waitFor(() => {
      expect(mocks.endMicrophoneMonitor).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps local monitoring silent below the configured manual threshold', async () => {
    const stream = {} as MediaStream;
    mocks.beginMicrophoneMonitor.mockResolvedValue(stream);
    mocks.getDiagnostics.mockReturnValue({
      status: 'active',
      message: null,
      activeEngine: 'deepfilternet3',
    });
    FakeAudioContext.sampleAmplitude = 0.0005;
    const session = new MicTestSession();

    await session.start(options());

    expect(FakeAudioContext.gains[0]?.value).toBe(0);
    expect(FakeAudioContext.gains[0]?.setTargetAtTime).not.toHaveBeenCalledWith(
      1,
      expect.any(Number),
      expect.any(Number),
    );
    session.stop();
  });

  it('opens local monitoring when voice crosses the configured threshold', async () => {
    const stream = {} as MediaStream;
    mocks.beginMicrophoneMonitor.mockResolvedValue(stream);
    mocks.getDiagnostics.mockReturnValue({
      status: 'active',
      message: null,
      activeEngine: 'deepfilternet3',
    });
    FakeAudioContext.sampleAmplitude = 0.1;
    const session = new MicTestSession();

    await session.start(options());

    expect(FakeAudioContext.gains[0]?.setTargetAtTime).toHaveBeenCalledWith(
      1,
      0,
      0.008,
    );
    session.stop();
  });

  it('applies a changed threshold to the running monitor without restarting it', async () => {
    const stream = {} as MediaStream;
    mocks.beginMicrophoneMonitor.mockResolvedValue(stream);
    mocks.getDiagnostics.mockReturnValue({
      status: 'active',
      message: null,
      activeEngine: 'deepfilternet3',
    });
    FakeAudioContext.sampleAmplitude = 0.1;
    const session = new MicTestSession();
    await session.start(options());

    session.updateGateSettings('voice-activity', false, 95);

    expect(FakeAudioContext.gains[0]?.setTargetAtTime).toHaveBeenLastCalledWith(
      0,
      0,
      0.025,
    );
    session.stop();
  });

  it('falls back to the system output when a saved sink no longer exists', async () => {
    const stream = {} as MediaStream;
    mocks.beginMicrophoneMonitor.mockResolvedValue(stream);
    mocks.getDiagnostics.mockReturnValue({
      status: 'active',
      message: null,
      activeEngine: 'deepfilternet3',
    });
    let audio!: FakeAudio & { setSinkId: ReturnType<typeof vi.fn> };
    class FallbackAudio extends FakeAudio {
      setSinkId = vi.fn()
        .mockRejectedValueOnce(new Error('Requested device not found'))
        .mockResolvedValueOnce(undefined);

      constructor() {
        super();
        audio = this;
      }
    }
    vi.stubGlobal('Audio', FallbackAudio);
    const session = new MicTestSession();

    await session.start({ ...options(), outputDeviceId: 'missing-sink' });

    expect(audio.setSinkId.mock.calls).toEqual([
      ['missing-sink'],
      ['default'],
    ]);
    session.stop();
  });
});
