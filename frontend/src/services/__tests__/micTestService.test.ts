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
}));
vi.mock('../audioProcessingService', () => ({
  AudioProcessingService: mocks.AudioProcessingService,
}));

import { MicTestSession } from '../micTestService';

class FakeAudioContext {
  state: AudioContextState = 'running';
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => ({
    fftSize: 1024,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.fill(0)),
  }));
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
    onLevel: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
});
