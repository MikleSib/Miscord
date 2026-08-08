import { describe, expect, it } from 'vitest';

import { clampVoiceVolumePercent, combineVoiceVolumes } from '../voiceVolume';

describe('voice volume', () => {
  it('clamps invalid and out-of-range percentages', () => {
    expect(clampVoiceVolumePercent(Number.NaN)).toBe(100);
    expect(clampVoiceVolumePercent(-25)).toBe(0);
    expect(clampVoiceVolumePercent(135)).toBe(100);
  });

  it('combines global and participant volume', () => {
    expect(combineVoiceVolumes(100, 20)).toBe(0.2);
    expect(combineVoiceVolumes(50, 20)).toBe(0.1);
    expect(combineVoiceVolumes(0, 100)).toBe(0);
  });
});
