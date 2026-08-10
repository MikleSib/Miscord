import type { VoiceSettingsSnapshot } from '../voiceSettings';

export function buildGroupVoiceProcessingConfig(settings: VoiceSettingsSnapshot) {
  return {
    vadEnabled: true,
    noiseSuppression: settings.processing.noiseSuppression,
    noiseSuppressionEngine: settings.processing.noiseSuppressionEngine,
    echoCancellation: settings.processing.echoCancellation,
    autoGainControl: settings.processing.autoGainControl,
    voiceConditioning: settings.processing.voiceConditioning,
    useAdvancedNoiseSuppression:
      settings.processing.noiseSuppression &&
      settings.processing.noiseSuppressionEngine !== 'browser',
    speechProbabilityThreshold: Math.min(0.9, Math.max(0.1, settings.vadSensitivity / 100)),
  };
}
