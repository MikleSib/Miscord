import { beforeEach, describe, expect, it, vi } from 'vitest';

const sounds = vi.hoisted(() => ({ start: vi.fn(), join: vi.fn(), stop: vi.fn() }));

vi.mock('../../soundService', () => ({
  default: {
    playStreamStartSound: sounds.start,
    playStreamJoinSound: sounds.join,
    playStreamEndSound: sounds.stop,
  },
}));

import { playScreenShareSound } from '../screenShareSounds';

beforeEach(() => vi.clearAllMocks());

describe('screen share sounds', () => {
  it.each([
    ['start', 'start'],
    ['join', 'join'],
    ['stop', 'stop'],
  ] as const)('plays %s lifecycle sound', (event, expected) => {
    playScreenShareSound(event);
    expect(sounds[expected]).toHaveBeenCalledOnce();
  });
});
