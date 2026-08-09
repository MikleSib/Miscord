import sodium from 'sodium-native';

import { parseRtpHeader } from './rtp.js';

interface SodiumAesExtension {
  crypto_aead_aes256gcm_is_available(): boolean;
  crypto_aead_aes256gcm_encrypt(
    ciphertext: Buffer,
    message: Buffer,
    additionalData: Buffer,
    secretNonce: null,
    nonce: Buffer,
    key: Buffer,
  ): void;
  crypto_aead_aes256gcm_decrypt(
    message: Buffer,
    secretNonce: null,
    ciphertext: Buffer,
    additionalData: Buffer,
    nonce: Buffer,
    key: Buffer,
  ): boolean;
}

const sodiumAes = sodium as typeof sodium & SodiumAesExtension;

export type EncryptionMode =
  | 'aead_xchacha20_poly1305_rtpsize'
  | 'aead_aes256_gcm_rtpsize';

export const XCHACHA_MODE: EncryptionMode = 'aead_xchacha20_poly1305_rtpsize';
export const AES_GCM_MODE: EncryptionMode = 'aead_aes256_gcm_rtpsize';

function nonceLength(mode: EncryptionMode): number {
  return mode === XCHACHA_MODE ? 24 : 12;
}

export function supportedModes(): EncryptionMode[] {
  const modes: EncryptionMode[] = [XCHACHA_MODE];
  if (typeof sodiumAes.crypto_aead_aes256gcm_is_available === 'function' && sodiumAes.crypto_aead_aes256gcm_is_available()) {
    modes.unshift(AES_GCM_MODE);
  }
  return modes;
}

export class RtpCipher {
  private sendCounter = 0;
  private readonly received = new Set<number>();
  private highestReceived = -1;

  constructor(readonly mode: EncryptionMode, readonly key: Buffer) {
    if (key.length !== 32) throw new Error('Voice secret key must be 32 bytes');
    if (!supportedModes().includes(mode)) throw new Error('Unsupported voice encryption mode');
  }

  encrypt(packet: Buffer): Buffer {
    const header = parseRtpHeader(packet);
    const aad = packet.subarray(0, header.headerLength);
    const payload = packet.subarray(header.headerLength);
    const counter = this.sendCounter >>> 0;
    this.sendCounter = (this.sendCounter + 1) >>> 0;
    const nonce = Buffer.alloc(nonceLength(this.mode));
    nonce.writeUInt32BE(counter, 0);
    const ciphertext = Buffer.alloc(payload.length + 16);
    if (this.mode === XCHACHA_MODE) {
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ciphertext, payload, aad, null, nonce, this.key);
    } else {
      sodiumAes.crypto_aead_aes256gcm_encrypt(ciphertext, payload, aad, null, nonce, this.key);
    }
    const suffix = Buffer.allocUnsafe(4);
    suffix.writeUInt32BE(counter, 0);
    return Buffer.concat([aad, ciphertext, suffix]);
  }

  decrypt(packet: Buffer): Buffer {
    const header = parseRtpHeader(packet);
    if (packet.length < header.headerLength + 16 + 4) throw new Error('Encrypted RTP packet is too short');
    const counter = packet.readUInt32BE(packet.length - 4);
    this.checkReplay(counter);
    const aad = packet.subarray(0, header.headerLength);
    const ciphertext = packet.subarray(header.headerLength, packet.length - 4);
    const nonce = Buffer.alloc(nonceLength(this.mode));
    nonce.writeUInt32BE(counter, 0);
    const plaintext = Buffer.alloc(ciphertext.length - 16);
    const valid = this.mode === XCHACHA_MODE
      ? sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(plaintext, null, ciphertext, aad, nonce, this.key)
      : sodiumAes.crypto_aead_aes256gcm_decrypt(plaintext, null, ciphertext, aad, nonce, this.key);
    if (!valid) throw new Error('Invalid encrypted RTP packet');
    this.remember(counter);
    return Buffer.concat([aad, plaintext]);
  }

  private checkReplay(counter: number): void {
    if (this.received.has(counter)) throw new Error('Replayed RTP packet');
    if (this.highestReceived >= 0 && counter + 1024 < this.highestReceived) {
      throw new Error('RTP counter is outside the replay window');
    }
  }

  private remember(counter: number): void {
    this.received.add(counter);
    this.highestReceived = Math.max(this.highestReceived, counter);
    const floor = this.highestReceived - 1024;
    for (const value of this.received) {
      if (value < floor) this.received.delete(value);
    }
  }
}
