export function clampVoiceVolumePercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function combineVoiceVolumes(
  outputVolumePercent: number,
  participantVolumePercent: number,
): number {
  const outputFactor = clampVoiceVolumePercent(outputVolumePercent) / 100;
  const participantFactor = clampVoiceVolumePercent(participantVolumePercent) / 100;
  return Math.min(1, Math.max(0, outputFactor * participantFactor));
}
