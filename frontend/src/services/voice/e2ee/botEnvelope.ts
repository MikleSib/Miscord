import { base64ToBytes, bytesToBase64 } from './mlsRuntime';

export type BotE2eeEndpoint = {
  session_id: string;
  credential_id: string;
  public_key: string;
};

export type BotKeyEnvelope = {
  session_id: string;
  credential_id: string;
  ephemeral_key: string;
  salt: string;
  iv: string;
  ciphertext: string;
};

function envelopeInfo(epoch: string, credentialId: string): Uint8Array {
  return new TextEncoder().encode(`miscord-bot-media-envelope-v1\0${epoch}\0${credentialId}`);
}

export async function sealBotEpochSecret(
  endpoint: BotE2eeEndpoint,
  epoch: string,
  rootSecret: Uint8Array,
): Promise<BotKeyEnvelope> {
  const publicKey = await crypto.subtle.importKey(
    'spki', base64ToBytes(endpoint.public_key),
    { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey }, ephemeral.privateKey, 256,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const info = envelopeInfo(epoch, endpoint.credential_id);
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt, info,
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: info, tagLength: 128,
  }, key, rootSecret);
  const ephemeralKey = await crypto.subtle.exportKey('spki', ephemeral.publicKey);
  return {
    session_id: endpoint.session_id,
    credential_id: endpoint.credential_id,
    ephemeral_key: bytesToBase64(new Uint8Array(ephemeralKey)),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function sealBotEpochSecrets(
  endpoints: BotE2eeEndpoint[] | undefined,
  epoch: string,
  rootSecret: Uint8Array,
): Promise<BotKeyEnvelope[]> {
  return Promise.all((endpoints ?? []).map((endpoint) =>
    sealBotEpochSecret(endpoint, epoch, rootSecret)));
}
