export type NoiseSuppressionEngine =
  | 'deepfilternet3'
  | 'miscord-ai'
  | 'browser';

/** Maps old/unknown persisted engines to the primary local neural engine. */
export function normalizeNoiseSuppressionEngine(
  value: unknown,
): NoiseSuppressionEngine {
  if (value === 'browser' || value === 'miscord-ai' || value === 'deepfilternet3') {
    return value;
  }
  return 'deepfilternet3';
}
