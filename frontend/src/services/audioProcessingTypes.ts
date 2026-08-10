import type {
  NoiseSuppressionEngine,
  NoiseSuppressionRuntimeStatus,
} from '../store/noiseSuppressionStore';

export interface AudioProcessingConfig {
  vadEnabled: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  voiceConditioning: boolean;
  speechProbabilityThreshold: number;
  useAdvancedNoiseSuppression: boolean;
  noiseSuppressionEngine: NoiseSuppressionEngine;
}

export interface SupportedNoiseSuppressionEngine {
  engine: NoiseSuppressionEngine;
  supported: boolean;
  name: string;
}

export interface AudioProcessingDiagnostics {
  status: NoiseSuppressionRuntimeStatus;
  message: string | null;
  configuredEngine: NoiseSuppressionEngine | null;
  activeEngine: NoiseSuppressionEngine | null;
  captureSettings: MediaTrackSettings | null;
  unsupportedConstraints: string[];
  lsnr: number | null;
  wetRms: number | null;
  dryRms: number | null;
  rtf: number | null;
  overloadRatio: number | null;
  glitchSamples: number | null;
  droppedSamples: number | null;
}

export interface AudioProcessingServiceOptions {
  publishRuntimeStatus?: boolean;
  onRuntimeStatus?: (
    status: NoiseSuppressionRuntimeStatus,
    message: string | null,
    engine: NoiseSuppressionEngine | null,
  ) => void;
}

export const DEFAULT_AUDIO_PROCESSING_CONFIG: AudioProcessingConfig = {
  vadEnabled: false,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  voiceConditioning: true,
  speechProbabilityThreshold: 0.35,
  useAdvancedNoiseSuppression: true,
  noiseSuppressionEngine: 'deepfilternet3',
};

export const createEmptyDiagnostics = (): AudioProcessingDiagnostics => ({
  status: 'idle',
  message: null,
  configuredEngine: null,
  activeEngine: null,
  captureSettings: null,
  unsupportedConstraints: [],
  lsnr: null,
  wetRms: null,
  dryRms: null,
  rtf: null,
  overloadRatio: null,
  glitchSamples: null,
  droppedSamples: null,
});
