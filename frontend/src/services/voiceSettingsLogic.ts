import type { NoiseSuppressionEngine } from '../store/noiseSuppressionStore';
import { normalizeNoiseSuppressionEngine } from './noiseSuppressionEngine';

export type VoiceProcessingProfile = 'isolation' | 'studio' | 'custom';

export interface VoiceProcessingSettings {
  noiseSuppression: boolean;
  noiseSuppressionEngine: NoiseSuppressionEngine;
  echoCancellation: boolean;
  autoGainControl: boolean;
  voiceConditioning: boolean;
}

export interface VoiceSettingsSnapshot {
  inputDeviceId: string;
  outputDeviceId: string;
  inputVolume: number;
  outputVolume: number;
  profile: VoiceProcessingProfile;
  processing: VoiceProcessingSettings;
  inputMode: 'voice-activity' | 'push-to-talk';
  vadSensitivity: number;
  autoDetectSensitivity: boolean;
  pttKey: string;
  pttDelay: number;
}

export const DEFAULT_CUSTOM_PROCESSING: VoiceProcessingSettings = {
  noiseSuppression: true,
  noiseSuppressionEngine: 'browser',
  echoCancellation: true,
  autoGainControl: true,
  voiceConditioning: true,
};

export function getEffectiveProcessingSettings(
  profile: VoiceProcessingProfile,
  customSettings: VoiceProcessingSettings,
): VoiceProcessingSettings {
  if (profile === 'isolation') {
    return {
      noiseSuppression: true,
      noiseSuppressionEngine: 'deepfilternet3',
      echoCancellation: true,
      // Браузерный AGC при нейросети выключается: он поднимал бы шум до модели.
      // Мягкое выравнивание выполняется один раз после очищенного сигнала.
      autoGainControl: true,
      voiceConditioning: true,
    };
  }

  if (profile === 'studio') {
    return {
      noiseSuppression: false,
      noiseSuppressionEngine: customSettings.noiseSuppressionEngine,
      echoCancellation: false,
      autoGainControl: false,
      voiceConditioning: false,
    };
  }

  return { ...customSettings };
}

export function migrateLegacyProfile(
  enabled: boolean,
  engine: unknown,
): VoiceProcessingProfile {
  if (!enabled) return 'studio';
  const normalized = normalizeNoiseSuppressionEngine(engine);
  return normalized === 'miscord-ai' || normalized === 'deepfilternet3'
    ? 'isolation'
    : 'custom';
}

export function sensitivityToDbfs(sensitivity: number): number {
  return Math.max(-100, Math.min(0, sensitivity - 100));
}

export function calculateAutoThreshold(samples: number[]): number {
  if (samples.length === 0) return -45;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.2));
  const noiseFloor = sorted[index];
  return Math.max(-60, Math.min(-25, noiseFloor + 12));
}

/**
 * Выше 100% слайдер усиливает, а не только приглушает: нейросетевой шумодав
 * умеет лишь убавлять уровень, поэтому тихому микрофону нужен ручной запас.
 */
export const MAX_INPUT_VOLUME_PERCENT = 200;

export function linearGain(volume: number): number {
  return Math.max(0, Math.min(MAX_INPUT_VOLUME_PERCENT, volume)) / 100;
}

export function normalizePTTDelay(delay: number): number {
  return Math.max(0, Math.min(2000, Math.round(delay)));
}

export function shouldTransmit(
  muted: boolean,
  inputMode: 'voice-activity' | 'push-to-talk',
  vadActive: boolean,
  pttActive: boolean,
): boolean {
  return !muted && (inputMode === 'push-to-talk' ? pttActive : vadActive);
}
