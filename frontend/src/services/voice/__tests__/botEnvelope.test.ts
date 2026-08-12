import { describe, expect, it } from 'vitest';

import { sealBotEpochSecret } from '../e2ee/botEnvelope';
import { base64ToBytes, bytesToBase64 } from '../e2ee/mlsRuntime';

describe('bot E2EE key envelope', () => {
  it('can only be opened by the bot endpoint private key', async () => {
    const bot = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
    );
    const publicKey = await crypto.subtle.exportKey('spki', bot.publicKey);
    const root = crypto.getRandomValues(new Uint8Array(32));
    const endpoint = {
      session_id: 'bot-session', credential_id: '42:bot-session',
      public_key: bytesToBase64(new Uint8Array(publicKey)),
    };
    const envelope = await sealBotEpochSecret(endpoint, '9', root);
    const ephemeral = await crypto.subtle.importKey(
      'spki', base64ToBytes(envelope.ephemeral_key),
      { name: 'ECDH', namedCurve: 'P-256' }, false, [],
    );
    const shared = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: ephemeral }, bot.privateKey, 256,
    );
    const info = new TextEncoder().encode(
      ['miscord-bot-media-envelope-v1', '9', '42:bot-session'].join('\0'),
    );
    const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({
      name: 'HKDF', hash: 'SHA-256', salt: base64ToBytes(envelope.salt), info,
    }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const clear = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: base64ToBytes(envelope.iv),
      additionalData: info, tagLength: 128,
    }, key, base64ToBytes(envelope.ciphertext));
    expect(new Uint8Array(clear)).toEqual(root);
  });
});
