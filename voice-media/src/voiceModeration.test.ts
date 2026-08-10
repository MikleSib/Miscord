import { describe, expect, it, vi } from 'vitest';

import { Room } from './room.js';

describe('Room voice moderation', () => {
  it('does not resume a server-muted microphone when the client unmutes itself', async () => {
    const producer = { pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined) };
    const peer = { selfMuted: true, serverMuted: true };
    const room = Object.create(Room.prototype) as Room;

    await room.setProducerSelfMuted(peer as never, producer as never, false);

    expect(peer.selfMuted).toBe(false);
    expect(producer.pause).toHaveBeenCalledOnce();
    expect(producer.resume).not.toHaveBeenCalled();
  });
});
