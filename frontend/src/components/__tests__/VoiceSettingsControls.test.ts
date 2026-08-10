import { describe, expect, it } from 'vitest';
import { meterLevelToDbfs } from '../voiceSensitivityMeter';

describe('meterLevelToDbfs', () => {
  it('maps the silent meter state to the sensitivity floor', () => {
    expect(meterLevelToDbfs(0)).toBe(-100);
  });

  it('restores the RMS level used by the microphone test meter', () => {
    expect(meterLevelToDbfs(0.5)).toBeCloseTo(-20, 5);
  });

  it('clamps out-of-range meter values', () => {
    expect(meterLevelToDbfs(-1)).toBe(-100);
    expect(meterLevelToDbfs(2)).toBeCloseTo(-13.9794, 4);
  });
});
