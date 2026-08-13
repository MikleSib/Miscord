import api from '../api';

export interface E2eeDevice {
  device_id: string;
  credential_id: string;
  key_package: string;
  key_package_id: string;
  signature_public_key: string;
}

export interface SecretSession {
  session_id: string;
  founder_user_id: number;
  founder_device_id: string;
  recipient_device_id: string;
  welcome: string;
  ratchet_tree: string;
  local_device_id: string | null;
  device_matches: boolean;
}

export interface SecretWireMessage {
  id: number;
  client_nonce: string | null;
  timestamp: string;
  sender_id: number;
  recipient_id: number;
  encryption_version: number;
  ciphertext: string;
  secret_session_id: string;
  sender_device_id: string;
}

export class PeerEncryptionUnavailableError extends Error {
  constructor() {
    super('Собеседник ещё не активировал сквозное шифрование. Оно включится автоматически после его следующего входа в Miscord.');
    this.name = 'PeerEncryptionUnavailableError';
  }
}

export function requirePeerDevice(device: E2eeDevice | null): E2eeDevice {
  if (!device) throw new PeerEncryptionUnavailableError();
  return device;
}

export const secretDmApi = {
  registerDevice: (payload: {
    device_id: string;
    credential_id: string;
    key_package: string;
    signature_public_key: string;
  }) => api.put<E2eeDevice>('/api/v1/e2ee/devices/@me', payload).then((response) => response.data),
  peerDevice: (peerId: number) => api.get<E2eeDevice | null>(`/api/v1/e2ee/users/${peerId}/device`).then((response) => response.data),
  session: (peerId: number) => api.get<SecretSession | null>(`/api/v1/e2ee/dms/${peerId}/session`).then((response) => response.data),
  createSession: (peerId: number, payload: {
    session_id: string;
    founder_device_id: string;
    recipient_device_id: string;
    recipient_key_package_id: string;
    welcome: string;
    ratchet_tree: string;
  }) => api.post<SecretSession>(`/api/v1/e2ee/dms/${peerId}/session`, payload).then((response) => response.data),
  resetSession: (peerId: number) => api.delete(`/api/v1/e2ee/dms/${peerId}/session`),
  messages: (peerId: number, skip = 0, limit = 30) => api
    .get<SecretWireMessage[]>(`/api/v1/e2ee/dms/${peerId}/messages?skip=${skip}&limit=${limit}`)
    .then((response) => response.data),
};
