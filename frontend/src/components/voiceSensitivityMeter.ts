export const meterLevelToDbfs = (level: number): number => {
  const normalizedLevel = Math.max(0, Math.min(1, level));
  if (normalizedLevel === 0) return -100;
  const rms = normalizedLevel / 5;
  return Math.max(-100, Math.min(0, 20 * Math.log10(rms)));
};
