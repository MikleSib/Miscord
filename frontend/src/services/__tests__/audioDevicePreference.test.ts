import { describe, expect, it } from 'vitest';
import {
  createAudioDevicePreference,
  resolveAudioDevicePreference,
} from '../audioDevicePreference';

const device = (
  deviceId: string,
  groupId: string,
  label: string,
): MediaDeviceInfo => ({ deviceId, groupId, label } as MediaDeviceInfo);

describe('audio device preference', () => {
  it('keeps the exact persisted browser device id when it is still available', () => {
    const saved = createAudioDevicePreference(
      'mic-old',
      device('mic-old', 'usb-group', 'USB Microphone'),
    );
    const result = resolveAudioDevicePreference(
      'mic-old',
      saved,
      [device('mic-old', 'usb-group', 'USB Microphone')],
    );
    expect(result?.deviceId).toBe('mic-old');
  });

  it('finds the same physical device after the browser rotates its id', () => {
    const saved = createAudioDevicePreference(
      'mic-old',
      device('mic-old', 'usb-group', 'USB Microphone'),
    );
    const result = resolveAudioDevicePreference(
      'mic-old',
      saved,
      [device('mic-new', 'usb-group', 'USB Microphone')],
    );
    expect(result?.deviceId).toBe('mic-new');
  });

  it('falls back to the stable label when group ids are unavailable', () => {
    const saved = createAudioDevicePreference(
      'sink-old',
      device('sink-old', '', 'USB Headphones'),
    );
    const result = resolveAudioDevicePreference(
      'sink-old',
      saved,
      [device('sink-new', '', 'USB Headphones')],
    );
    expect(result?.deviceId).toBe('sink-new');
  });
});
