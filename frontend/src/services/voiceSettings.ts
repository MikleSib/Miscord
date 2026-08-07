import { useAudioDeviceStore } from '../store/audioDeviceStore';
import { useVADSettingsStore } from '../store/vadSettingsStore';
import { useVoiceProcessingSettingsStore } from '../store/voiceProcessingSettingsStore';
import {
  getEffectiveProcessingSettings,
  type VoiceProcessingSettings,
  type VoiceSettingsSnapshot,
} from './voiceSettingsLogic';

export * from './voiceSettingsLogic';

export function getVoiceSettingsSnapshot(): VoiceSettingsSnapshot {
  const devices = useAudioDeviceStore.getState();
  const vad = useVADSettingsStore.getState();
  const processing = useVoiceProcessingSettingsStore.getState();

  return {
    inputDeviceId: devices.inputDeviceId,
    outputDeviceId: devices.outputDeviceId,
    inputVolume: devices.inputVolume,
    outputVolume: devices.outputVolume,
    profile: processing.profile,
    processing: getEffectiveProcessingSettings(
      processing.profile,
      processing.customSettings,
    ),
    inputMode: vad.inputMode,
    vadSensitivity: vad.vadSensitivity,
    autoDetectSensitivity: vad.autoDetectSensitivity,
    pttKey: vad.pttKey,
    pttDelay: vad.pttDelay,
  };
}

export function buildAudioCaptureConstraints(
  processing: VoiceProcessingSettings,
  deviceId?: string,
): MediaTrackConstraints {
  const supported =
    typeof navigator !== 'undefined' && navigator.mediaDevices
      ? navigator.mediaDevices.getSupportedConstraints()
      : {};
  const constraints: MediaTrackConstraints = {};

  if (deviceId && deviceId !== 'default') {
    constraints.deviceId = { ideal: deviceId };
  }
  if (supported.channelCount) constraints.channelCount = { ideal: 1 };
  if (supported.echoCancellation) {
    constraints.echoCancellation = { ideal: processing.echoCancellation };
  }
  if (supported.autoGainControl) {
    constraints.autoGainControl = { ideal: processing.autoGainControl };
  }
  if (supported.noiseSuppression) {
    constraints.noiseSuppression = {
      ideal:
        processing.noiseSuppression &&
        processing.noiseSuppressionEngine === 'browser',
    };
  }

  return constraints;
}

export async function captureAudioStream(
  processing: VoiceProcessingSettings,
  deviceId?: string,
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: buildAudioCaptureConstraints(processing, deviceId),
      video: false,
    });
  } catch (error) {
    const errorName =
      typeof error === 'object' && error !== null && 'name' in error
        ? String(error.name)
        : '';
    if (errorName !== 'OverconstrainedError') throw error;

    console.warn(
      '[VoiceSettings] Аудиоустройство не поддерживает сохранённые параметры, используем системный микрофон.',
    );
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
}
