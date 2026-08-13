import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerDevice: vi.fn(),
  saveSecretState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./secretDmApi', () => ({
  requirePeerDevice: (device: unknown) => device,
  secretDmApi: { registerDevice: mocks.registerDevice },
}));

vi.mock('./secretDmStorage', () => ({
  loadSecretState: vi.fn().mockResolvedValue(null),
  saveSecretState: mocks.saveSecretState,
  loadSecretPlaintext: vi.fn(),
  saveSecretPlaintext: vi.fn(),
}));

vi.mock('../voice/e2ee/mlsRuntime', () => {
  class Provider {
    export_state() { return new Uint8Array([1]); }
    free() {}
  }
  class Identity {
    export_state() { return new Uint8Array([2]); }
    key_package() { return new Uint8Array([3]); }
    signature_public_key() { return new Uint8Array([4]); }
    free() {}
  }
  return {
    base64ToBytes: (value: string) => new Uint8Array(Buffer.from(value, 'base64')),
    bytesToBase64: (value: Uint8Array) => Buffer.from(value).toString('base64'),
    loadMlsModule: vi.fn().mockResolvedValue({ Provider, Identity }),
  };
});

import { SecretDmCrypto } from './secretDmCrypto';

describe('SecretDmCrypto device publication', () => {
  beforeEach(() => {
    mocks.registerDevice.mockReset();
    mocks.saveSecretState.mockClear();
  });

  it('retries server publication after a transient first failure', async () => {
    mocks.registerDevice
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({});
    const cryptoService = new SecretDmCrypto();

    await expect(cryptoService.initialize(29)).rejects.toThrow('temporary network failure');
    await expect(cryptoService.initialize(29)).resolves.toBeUndefined();

    expect(mocks.registerDevice).toHaveBeenCalledTimes(2);
    await cryptoService.close(29);
  });
});
