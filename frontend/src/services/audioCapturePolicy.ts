import type { NoiseSuppressionEngine } from '../store/noiseSuppressionStore';

export const isNeuralNoiseSuppressionEngine = (
  engine: NoiseSuppressionEngine,
): boolean => engine === 'miscord-ai' || engine === 'deepfilternet3';

export const getNoiseSuppressionFallbackChain = (
  engine: NoiseSuppressionEngine,
): NoiseSuppressionEngine[] => {
  if (engine === 'deepfilternet3') return ['miscord-ai', 'browser'];
  if (engine === 'miscord-ai') return ['browser'];
  return [];
};

export const resolveBrowserAutoGainControl = (
  configured: boolean,
  engine: NoiseSuppressionEngine,
  noiseSuppressionEnabled: boolean,
): boolean =>
  noiseSuppressionEnabled && isNeuralNoiseSuppressionEngine(engine)
    ? false
    : configured;

export const isNoiseSuppressionFallbackCurrent = (
  enabled: boolean,
  expectedPipeline: number,
  currentPipeline: number,
  expectedTransition: number,
  currentTransition: number,
): boolean =>
  enabled &&
  expectedPipeline === currentPipeline &&
  expectedTransition === currentTransition;
