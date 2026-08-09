import { describe, expect, it } from 'vitest';

import {
  discoveryResponse,
  discoverySsrc,
  isDiscoveryPacket,
  makeRtpPacket,
  parseRtpHeader,
} from './rtp.js';

describe('RTP v1', () => {
  it('creates Opus packets with uint wrap', () => {
    const packet = makeRtpPacket(Buffer.from([1, 2, 3]), 0x1ffff, 0x1ffffffff, 0xdeadbeef);
    const header = parseRtpHeader(packet);
    expect(header.sequence).toBe(0xffff);
    expect(header.timestamp).toBe(0xffffffff);
    expect(header.ssrc).toBe(0xdeadbeef);
    expect(header.payloadType).toBe(120);
  });

  it('parses exact 74-byte discovery packets', () => {
    const request = Buffer.alloc(74);
    request.writeUInt16BE(1, 0);
    request.writeUInt16BE(70, 2);
    request.writeUInt32BE(123456, 4);
    expect(isDiscoveryPacket(request)).toBe(true);
    expect(discoverySsrc(request)).toBe(123456);
    const response = discoveryResponse(123456, '127.0.0.1', 50000);
    expect(response).toHaveLength(74);
    expect(response.readUInt16BE(0)).toBe(2);
    expect(response.readUInt16BE(72)).toBe(50000);
  });
});
