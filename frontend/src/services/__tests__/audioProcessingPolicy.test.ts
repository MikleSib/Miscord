import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getNoiseSuppressionFallbackChain,
  isNoiseSuppressionFallbackCurrent,
  resolveBrowserAutoGainControl,
} from '../audioCapturePolicy';
import { buildAudioCaptureConstraints } from '../voiceSettings';
import {
  configureMonoDestination,
  switchToDryBeforeTeardown,
} from '../audioProcessingGraph';
import { normalizeNoiseSuppressionEngine } from '../noiseSuppressionEngine';
import { SingleFlight } from '../singleFlight';

describe('Miscord AI live pipeline policy', () => {
  it('disables browser AGC only while neural suppression is enabled', () => {
    expect(resolveBrowserAutoGainControl(true, 'deepfilternet3', true)).toBe(false);
    expect(resolveBrowserAutoGainControl(true, 'miscord-ai', true)).toBe(false);
    expect(resolveBrowserAutoGainControl(true, 'browser', true)).toBe(true);
    expect(resolveBrowserAutoGainControl(true, 'deepfilternet3', false)).toBe(true);
    expect(resolveBrowserAutoGainControl(true, 'miscord-ai', false)).toBe(true);
  });

  it('keeps optional AEC while avoiding double browser processing', () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getSupportedConstraints: () => ({
            echoCancellation: true,
            autoGainControl: true,
            noiseSuppression: true,
          }),
        },
      },
    });
    try {
      const constraints = buildAudioCaptureConstraints({
        noiseSuppression: true,
        noiseSuppressionEngine: 'deepfilternet3',
        echoCancellation: false,
        autoGainControl: true,
        voiceConditioning: true,
      });
      expect(constraints.echoCancellation).toEqual({ ideal: false });
      expect(constraints.autoGainControl).toEqual({ ideal: false });
      expect(constraints.noiseSuppression).toEqual({ ideal: false });
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it('preserves valid engines and maps unknown values to the primary engine', () => {
    expect(normalizeNoiseSuppressionEngine('deepfilternet3')).toBe('deepfilternet3');
    expect(normalizeNoiseSuppressionEngine('miscord-ai')).toBe('miscord-ai');
    expect(normalizeNoiseSuppressionEngine('unknown')).toBe('deepfilternet3');
    expect(normalizeNoiseSuppressionEngine('browser')).toBe('browser');
  });

  it('falls back from DeepFilterNet3 to RNNoise and then browser processing', () => {
    expect(getNoiseSuppressionFallbackChain('deepfilternet3')).toEqual([
      'miscord-ai',
      'browser',
    ]);
    expect(getNoiseSuppressionFallbackChain('miscord-ai')).toEqual(['browser']);
    expect(getNoiseSuppressionFallbackChain('browser')).toEqual([]);
  });

  it('ships natural-speech worklet settings and a fresh cache key', () => {
    const root = process.cwd();
    const worklet = readFileSync(
      join(root, 'public/audio/deepfilternet3/dfn3-worklet.js'),
      'utf8',
    );
    const suppressor = readFileSync(
      join(root, 'src/services/deepFilterNet3NoiseSuppressor.ts'),
      'utf8',
    );
    const base = readFileSync(
      join(root, 'src/services/audioProcessingServiceBase.ts'),
      'utf8',
    );

    expect(worklet).not.toContain('ImpulseSuppressor');
    expect(worklet).toContain('const INFERENCE_OVERLOAD_MS = 2.5');
    expect(worklet).toContain('_dfn3_wasm_set_min_db_thresh(-10)');
    expect(worklet).toContain('_dfn3_wasm_set_max_db_erb_thresh(30)');
    expect(worklet).toContain('_dfn3_wasm_set_post_filter_beta(0)');
    expect(worklet).toContain('_dfn3_wasm_set_hpf(0)');
    expect(worklet).not.toContain('AGC_OUTPUT_COMPRESSION_DB');
    expect(suppressor).toContain('dfn3-worklet.js?v=2026-08-10-natural-voice');
    expect(base).toContain('const NEURAL_OUTPUT_MAKEUP = 1;');
    expect(base).toContain('if (this.usesNeuralEngine())');
    expect(base).toContain('if (this.config.autoGainControl)');
    expect(base).not.toMatch(/createOscillator|frequency\.value\s*=\s*20/);
  });

  it('configures the processed microphone destination as explicit mono', () => {
    const destination = {
      channelCount: 2,
      channelCountMode: 'max' as ChannelCountMode,
      channelInterpretation: 'speakers' as ChannelInterpretation,
    };
    configureMonoDestination(destination);
    expect(destination).toEqual({
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    });
  });

  it('deduplicates simultaneous fallback attempts', async () => {
    const flight = new SingleFlight();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let starts = 0;
    const task = () => {
      starts += 1;
      return gate;
    };

    const first = flight.run(task);
    const second = flight.run(task);
    expect(starts).toBe(1);
    release();
    await Promise.all([first, second]);
    await flight.run(async () => {
      starts += 1;
    });
    expect(starts).toBe(2);
  });

  it('rejects a late fallback after suppression is disabled or superseded', () => {
    expect(isNoiseSuppressionFallbackCurrent(false, 4, 4, 8, 8)).toBe(false);
    expect(isNoiseSuppressionFallbackCurrent(true, 4, 5, 8, 8)).toBe(false);
    expect(isNoiseSuppressionFallbackCurrent(true, 4, 4, 8, 9)).toBe(false);
    expect(isNoiseSuppressionFallbackCurrent(true, 4, 4, 8, 8)).toBe(true);
  });

  it('opens dry and closes wet before tearing down a neural node', () => {
    const events: string[] = [];
    const param = (name: string, value: number): AudioParam => {
      const result = {
        value,
        cancelScheduledValues: () => {
          events.push(`${name}:cancel`);
          return result;
        },
        setValueAtTime: (next: number) => {
          events.push(`${name}:set:${next}`);
          return result;
        },
      } as unknown as AudioParam;
      return result;
    };

    switchToDryBeforeTeardown(
      param('dry', 0),
      param('wet', 1),
      10,
      () => events.push('destroy'),
    );

    expect(events).toEqual([
      'dry:cancel',
      'dry:set:1',
      'wet:cancel',
      'wet:set:0',
      'destroy',
    ]);
  });
});
