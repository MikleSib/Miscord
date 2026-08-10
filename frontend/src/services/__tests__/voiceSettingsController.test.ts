import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  switchInputDevice: vi.fn(),
  setOutputDevice: vi.fn(),
  getAppliedInputDeviceId: vi.fn(() => 'default'),
}));
const devices = vi.hoisted(() => ({
  inputDeviceId: 'default', outputDeviceId: 'default', inputVolume: 100, outputVolume: 100,
  setInputDeviceId: vi.fn((deviceId: string) => { devices.inputDeviceId = deviceId; }),
  setOutputDeviceId: vi.fn((deviceId: string) => { devices.outputDeviceId = deviceId; }),
}));

vi.mock('../optimizedVoiceService', () => ({
  default: service,
}));
vi.mock('../../store/audioDeviceStore', () => ({
  useAudioDeviceStore: { getState: () => devices },
}));

import { voiceSettingsController } from '../voiceSettingsController';

describe('VoiceSettingsController device persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.switchInputDevice.mockResolvedValue(undefined);
    service.setOutputDevice.mockResolvedValue(undefined);
    service.getAppliedInputDeviceId.mockReturnValue('default');
    devices.inputDeviceId = 'default';
    devices.outputDeviceId = 'default';
  });

  it('persists a new input device after the service accepts it', async () => {
    service.getAppliedInputDeviceId.mockReturnValue('mic-usb');
    await voiceSettingsController.setInputDevice('mic-usb');

    expect(service.switchInputDevice).toHaveBeenCalledWith('mic-usb');
    expect(devices.inputDeviceId).toBe('mic-usb');
    expect(voiceSettingsController.getSnapshot().inputDeviceId).toBe('mic-usb');
  });

  it('persists a new output device after the service accepts it', async () => {
    await voiceSettingsController.setOutputDevice('headphones-usb');

    expect(service.setOutputDevice).toHaveBeenCalledWith('headphones-usb');
    expect(devices.outputDeviceId).toBe('headphones-usb');
    expect(voiceSettingsController.getSnapshot().outputDeviceId).toBe('headphones-usb');
  });

  it('does not persist a device when switching fails', async () => {
    service.switchInputDevice.mockRejectedValueOnce(new Error('device unavailable'));
    service.setOutputDevice.mockRejectedValueOnce(new Error('sink unavailable'));

    await expect(voiceSettingsController.setInputDevice('missing-mic')).rejects.toThrow('device unavailable');
    await expect(voiceSettingsController.setOutputDevice('missing-sink')).rejects.toThrow('sink unavailable');
    expect(devices).toMatchObject({
      inputDeviceId: 'default',
      outputDeviceId: 'default',
    });
  });

  it('restores the actually bridged input when the latest request fails', async () => {
    service.getAppliedInputDeviceId.mockReturnValue('mic-A');
    service.switchInputDevice.mockRejectedValueOnce(new Error('mic-B capture failed'));

    await expect(voiceSettingsController.setInputDevice('mic-B')).rejects.toThrow('mic-B capture failed');
    expect(devices.inputDeviceId).toBe('mic-A');
  });

  it('keeps the latest output selection when requests finish in reverse order', async () => {
    let resolveA!: () => void;
    let resolveB!: () => void;
    service.setOutputDevice
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveB = resolve; }));

    const first = voiceSettingsController.setOutputDevice('sink-A');
    const second = voiceSettingsController.setOutputDevice('sink-B');
    resolveB();
    await second;
    expect(devices.outputDeviceId).toBe('sink-B');
    resolveA();
    await first;
    expect(devices.outputDeviceId).toBe('sink-B');
  });

  it('forwards a return to the stored input while an older switch is pending', async () => {
    let resolveFirst!: () => void;
    service.switchInputDevice
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(undefined);

    const first = voiceSettingsController.setInputDevice('mic-A');
    const restore = voiceSettingsController.setInputDevice('default');
    await restore;
    expect(service.switchInputDevice).toHaveBeenLastCalledWith('default');
    resolveFirst();
    await first;
    expect(devices.inputDeviceId).toBe('default');
  });
});
