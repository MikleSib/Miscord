import { describe, expect, it } from 'vitest';
import { PeerEncryptionUnavailableError, requirePeerDevice } from './secretDmApi';

describe('peer encryption availability', () => {
  it('keeps a missing recipient key out of the HTTP error path', () => {
    expect(() => requirePeerDevice(null)).toThrow(PeerEncryptionUnavailableError);
    expect(() => requirePeerDevice(null)).toThrow('после его следующего входа');
  });

  it('returns an available device unchanged', () => {
    const device = {
      device_id: crypto.randomUUID(),
      credential_id: 'credential',
      key_package: 'package',
      key_package_id: crypto.randomUUID(),
      signature_public_key: 'signature',
    };
    expect(requirePeerDevice(device)).toBe(device);
  });
});
