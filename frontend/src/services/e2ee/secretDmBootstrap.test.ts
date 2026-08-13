import { describe, expect, it, vi } from 'vitest';
import { bindSecretDmBootstrap } from './secretDmBootstrap';

describe('global secret DM bootstrap', () => {
  it('registers encryption for every signed-in app view and cleans up once', async () => {
    const crypto = {
      initialize: vi.fn().mockResolvedValue(undefined),
      refreshKeyPackage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const listeners = new Map<string, () => void>();
    const socket = {
      on: vi.fn((event: string, callback: () => void) => { listeners.set(event, callback); }),
      off: vi.fn(),
    };

    const unbind = bindSecretDmBootstrap(17, crypto, socket);
    expect(crypto.initialize).toHaveBeenCalledWith(17);
    const identifiedListener = listeners.get('identified');
    identifiedListener?.();
    expect(crypto.initialize).toHaveBeenCalledTimes(2);
    const sessionListener = listeners.get('secret_dm_session');
    sessionListener?.();
    expect(crypto.refreshKeyPackage).toHaveBeenCalledWith(17);

    unbind();
    sessionListener?.();
    expect(crypto.refreshKeyPackage).toHaveBeenCalledTimes(1);
    expect(crypto.close).toHaveBeenCalledWith(17);
    expect(socket.off).toHaveBeenCalledWith('secret_dm_session', sessionListener);
    expect(socket.off).toHaveBeenCalledWith('identified', identifiedListener);
  });
});
