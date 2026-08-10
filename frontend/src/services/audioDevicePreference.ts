export interface AudioDevicePreference {
  deviceId: string;
  groupId: string;
  label: string;
}

export const createAudioDevicePreference = (
  deviceId: string,
  device?: Pick<MediaDeviceInfo, 'deviceId' | 'groupId' | 'label'>,
): AudioDevicePreference | null => {
  if (deviceId === 'default') return null;
  return {
    deviceId,
    groupId: device?.groupId ?? '',
    label: device?.label ?? '',
  };
};

export const resolveAudioDevicePreference = (
  deviceId: string,
  preference: AudioDevicePreference | null,
  devices: MediaDeviceInfo[],
): MediaDeviceInfo | null => {
  if (deviceId === 'default') return null;
  const exact = devices.find((device) => device.deviceId === deviceId);
  if (exact) return exact;
  if (preference?.groupId) {
    const grouped = devices.find(
      (device) => device.groupId === preference.groupId,
    );
    if (grouped) return grouped;
  }
  if (preference?.label) {
    return devices.find((device) => device.label === preference.label) ?? null;
  }
  return null;
};
