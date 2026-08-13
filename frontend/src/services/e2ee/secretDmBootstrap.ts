import websocketService from '../websocketService';
import { secretDmCrypto } from './secretDmCrypto';

interface SecretDmBootstrapCrypto {
  initialize(userId: number): Promise<void>;
  refreshKeyPackage(userId: number): Promise<void>;
  close(userId: number): Promise<void>;
}

interface SecretDmBootstrapSocket {
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
}

export function bindSecretDmBootstrap(
  userId: number,
  crypto: SecretDmBootstrapCrypto = secretDmCrypto,
  socket: SecretDmBootstrapSocket = websocketService,
): () => void {
  let active = true;
  void crypto.initialize(userId).catch(() => undefined);

  const refresh = () => {
    if (active) void crypto.refreshKeyPackage(userId).catch(() => undefined);
  };
  const retryInitialization = () => {
    if (active) void crypto.initialize(userId).catch(() => undefined);
  };
  socket.on('secret_dm_session', refresh);
  socket.on('identified', retryInitialization);

  return () => {
    active = false;
    socket.off('secret_dm_session', refresh);
    socket.off('identified', retryInitialization);
    void crypto.close(userId).catch(() => undefined);
  };
}
