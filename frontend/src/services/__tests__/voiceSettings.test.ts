import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOM_PROCESSING,
  calculateAutoThreshold,
  getEffectiveProcessingSettings,
  linearGain,
  migrateLegacyProfile,
  normalizePTTDelay,
  sensitivityToDbfs,
  shouldTransmit,
} from '../voiceSettingsLogic';

describe('voice processing profiles', () => {
  it('keeps Studio completely dry', () => {
    expect(
      getEffectiveProcessingSettings('studio', DEFAULT_CUSTOM_PROCESSING),
    ).toMatchObject({
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
      voiceConditioning: false,
    });
  });

  it('enables the full Miscord AI isolation preset', () => {
    expect(
      getEffectiveProcessingSettings('isolation', DEFAULT_CUSTOM_PROCESSING),
    ).toEqual({
      noiseSuppression: true,
      noiseSuppressionEngine: 'miscord-ai',
      echoCancellation: true,
      autoGainControl: true,
      voiceConditioning: true,
    });
  });

  it('does not overwrite manual Custom values', () => {
    const custom = {
      noiseSuppression: true,
      noiseSuppressionEngine: 'deepfilternet3' as const,
      echoCancellation: false,
      autoGainControl: false,
      voiceConditioning: true,
    };
    expect(getEffectiveProcessingSettings('custom', custom)).toEqual(custom);
  });
});

describe('legacy migration', () => {
  it('maps disabled denoising to Studio', () => {
    expect(migrateLegacyProfile(false, 'miscord-ai')).toBe('studio');
  });

  it('maps Miscord AI to Isolation and other engines to Custom', () => {
    expect(migrateLegacyProfile(true, 'miscord-ai')).toBe('isolation');
    expect(migrateLegacyProfile(true, 'browser')).toBe('custom');
    expect(migrateLegacyProfile(true, 'deepfilternet3')).toBe('custom');
  });
});

describe('voice level math', () => {
  it('uses one linear input gain', () => {
    expect(linearGain(0)).toBe(0);
    expect(linearGain(50)).toBe(0.5);
    expect(linearGain(100)).toBe(1);
    expect(linearGain(250)).toBe(1);
  });

  it('maps the persisted 0-100 sensitivity to -100..0 dBFS', () => {
    expect(sensitivityToDbfs(0)).toBe(-100);
    expect(sensitivityToDbfs(40)).toBe(-60);
    expect(sensitivityToDbfs(100)).toBe(0);
  });

  it('uses the lower noise quantile plus 12 dB and clamps it', () => {
    expect(calculateAutoThreshold([-55, -53, -52, -51, -20])).toBe(-41);
    expect(calculateAutoThreshold([-90, -88, -86])).toBe(-60);
    expect(calculateAutoThreshold([-20, -18, -16])).toBe(-25);
  });
});

describe('transmit gate and PTT', () => {
  it('never transmits while muted', () => {
    expect(shouldTransmit(true, 'voice-activity', true, false)).toBe(false);
    expect(shouldTransmit(true, 'push-to-talk', false, true)).toBe(false);
  });

  it('selects VAD or PTT according to the input mode', () => {
    expect(shouldTransmit(false, 'voice-activity', true, false)).toBe(true);
    expect(shouldTransmit(false, 'voice-activity', false, true)).toBe(false);
    expect(shouldTransmit(false, 'push-to-talk', true, false)).toBe(false);
    expect(shouldTransmit(false, 'push-to-talk', false, true)).toBe(true);
  });

  it('normalizes PTT release delay to 0-2000 ms', () => {
    expect(normalizePTTDelay(-10)).toBe(0);
    expect(normalizePTTDelay(450.4)).toBe(450);
    expect(normalizePTTDelay(5000)).toBe(2000);
  });
});
