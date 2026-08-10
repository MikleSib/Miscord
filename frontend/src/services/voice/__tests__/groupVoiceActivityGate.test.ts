import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupVoiceActivityGate } from '../groupVoiceActivityGate';

describe('GroupVoiceActivityGate', () => {
  afterEach(() => vi.useRealTimers());

  it('uses neural speech in automatic mode and preserves word endings', () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    const gate = new GroupVoiceActivityGate((open) => changes.push(open));
    gate.configure({ automatic: true, sensitivity: 50 });

    gate.updateNeuralSpeech(true);
    gate.updateNeuralSpeech(false);
    expect(gate.isOpen()).toBe(true);
    vi.advanceTimersByTime(319);
    expect(gate.isOpen()).toBe(true);
    vi.advanceTimersByTime(1);

    expect(gate.isOpen()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('opens only above the manual dBFS threshold with hysteresis', () => {
    vi.useFakeTimers();
    const gate = new GroupVoiceActivityGate(vi.fn());
    gate.configure({ automatic: false, sensitivity: 50 });

    gate.updateInputLevel(-51);
    expect(gate.isOpen()).toBe(false);
    gate.updateInputLevel(-49);
    expect(gate.isOpen()).toBe(true);
    gate.updateInputLevel(-53);
    vi.advanceTimersByTime(500);
    expect(gate.isOpen()).toBe(true);
    gate.updateInputLevel(-57);
    vi.advanceTimersByTime(320);
    expect(gate.isOpen()).toBe(false);
  });

  it('cancels a pending close when speech returns', () => {
    vi.useFakeTimers();
    const gate = new GroupVoiceActivityGate(vi.fn());
    gate.configure({ automatic: true, sensitivity: 50 });
    gate.updateNeuralSpeech(true);
    gate.updateNeuralSpeech(false);
    vi.advanceTimersByTime(200);
    gate.updateNeuralSpeech(true);
    vi.advanceTimersByTime(500);

    expect(gate.isOpen()).toBe(true);
  });
});
