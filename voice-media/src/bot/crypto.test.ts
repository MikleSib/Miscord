import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RtpCipher, XCHACHA_MODE } from './crypto.js';
import { makeRtpPacket } from './rtp.js';

describe('voice RTP AEAD', () => {
  it('authenticates the RTP header and payload', () => {
    const key = randomBytes(32);
    const sender = new RtpCipher(XCHACHA_MODE, key);
    const receiver = new RtpCipher(XCHACHA_MODE, key);
    const clear = makeRtpPacket(Buffer.from('opus'), 7, 960, 42);
    const encrypted = sender.encrypt(clear);
    expect(receiver.decrypt(encrypted)).toEqual(clear);

    const tampered = Buffer.from(sender.encrypt(clear));
    tampered[3] = (tampered[3] ?? 0) ^ 1;
    expect(() => new RtpCipher(XCHACHA_MODE, key).decrypt(tampered)).toThrow();
  });

  it('rejects replayed counters', () => {
    const key = randomBytes(32);
    const sender = new RtpCipher(XCHACHA_MODE, key);
    const receiver = new RtpCipher(XCHACHA_MODE, key);
    const packet = sender.encrypt(makeRtpPacket(Buffer.from([1]), 1, 1, 1));
    expect(receiver.decrypt(packet)).toBeDefined();
    expect(() => receiver.decrypt(packet)).toThrow('Replayed RTP packet');
  });
});
