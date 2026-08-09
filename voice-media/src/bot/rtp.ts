export const OPUS_PAYLOAD_TYPE = 120;
export const OPUS_SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

export interface RtpHeader {
  headerLength: number;
  sequence: number;
  timestamp: number;
  ssrc: number;
  payloadType: number;
}

export function parseRtpHeader(packet: Buffer): RtpHeader {
  if (packet.length < 12 || packet[0] === undefined || packet[1] === undefined) {
    throw new Error('RTP packet is too short');
  }
  const version = packet[0] >> 6;
  if (version !== 2) throw new Error('Unsupported RTP version');
  const csrcCount = packet[0] & 0x0f;
  const hasExtension = (packet[0] & 0x10) !== 0;
  let headerLength = 12 + csrcCount * 4;
  if (packet.length < headerLength) throw new Error('Invalid RTP CSRC list');
  if (hasExtension) {
    if (packet.length < headerLength + 4) throw new Error('Invalid RTP extension');
    const extensionWords = packet.readUInt16BE(headerLength + 2);
    headerLength += 4 + extensionWords * 4;
    if (packet.length < headerLength) throw new Error('Truncated RTP extension');
  }
  return {
    headerLength,
    sequence: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4),
    ssrc: packet.readUInt32BE(8),
    payloadType: packet[1] & 0x7f,
  };
}

export function rewriteSsrc(packet: Buffer, ssrc: number): Buffer {
  const result = Buffer.from(packet);
  result.writeUInt32BE(ssrc >>> 0, 8);
  return result;
}

export function makeRtpPacket(
  payload: Buffer,
  sequence: number,
  timestamp: number,
  ssrc: number,
  marker = false,
): Buffer {
  const packet = Buffer.allocUnsafe(12 + payload.length);
  packet[0] = 0x80;
  packet[1] = OPUS_PAYLOAD_TYPE | (marker ? 0x80 : 0);
  packet.writeUInt16BE(sequence & 0xffff, 2);
  packet.writeUInt32BE(timestamp >>> 0, 4);
  packet.writeUInt32BE(ssrc >>> 0, 8);
  payload.copy(packet, 12);
  return packet;
}

export function isDiscoveryPacket(packet: Buffer): boolean {
  return packet.length === 74 && packet.readUInt16BE(0) === 1 && packet.readUInt16BE(2) === 70;
}

export function discoverySsrc(packet: Buffer): number {
  if (!isDiscoveryPacket(packet)) throw new Error('Invalid UDP discovery packet');
  return packet.readUInt32BE(4);
}

export function discoveryResponse(ssrc: number, address: string, port: number): Buffer {
  const response = Buffer.alloc(74);
  response.writeUInt16BE(2, 0);
  response.writeUInt16BE(70, 2);
  response.writeUInt32BE(ssrc >>> 0, 4);
  Buffer.from(address, 'utf8').subarray(0, 63).copy(response, 8);
  response.writeUInt16BE(port, 72);
  return response;
}
