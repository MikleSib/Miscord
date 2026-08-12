import axios from 'axios';
import { secretDmApi, type E2eeDevice, type SecretSession, type SecretWireMessage } from './secretDmApi';
import { loadSecretPlaintext, loadSecretState, saveSecretPlaintext, saveSecretState } from './secretDmStorage';
import { base64ToBytes, bytesToBase64, loadMlsModule } from '../voice/e2ee/mlsRuntime';
import type { MlsGroup, MlsIdentity, MlsModule, MlsProvider } from '../voice/e2ee/mlsTypes';

interface PersistedState {
  version: 1;
  deviceId: string;
  credentialId: string;
  provider: string;
  identity: string;
}

export interface DecryptedSecretMessage extends SecretWireMessage {
  content: string;
  decryptError?: string;
}

interface ActiveSession {
  descriptor: SecretSession;
  group: MlsGroup;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function apiMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') return detail;
  }
  return error instanceof Error ? error.message : 'End-to-end encryption failed';
}

class SecretDmCrypto {
  private userId: number | null = null;
  private module: MlsModule | null = null;
  private provider: MlsProvider | null = null;
  private identity: MlsIdentity | null = null;
  private state: PersistedState | null = null;
  private sessions = new Map<number, ActiveSession>();
  private tail: Promise<void> = Promise.resolve();

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private dispose(): void {
    for (const session of this.sessions.values()) session.group.free();
    this.sessions.clear();
    this.identity?.free();
    this.provider?.free();
    this.identity = null;
    this.provider = null;
    this.state = null;
    this.module = null;
    this.userId = null;
  }

  async initialize(userId: number): Promise<void> {
    return this.run(async () => {
      if (this.userId === userId && this.provider && this.identity) return;
      this.dispose();
      this.userId = userId;
      const module = await loadMlsModule();
      const saved = await loadSecretState(userId);
      if (saved) {
        const state = JSON.parse(saved) as PersistedState;
        if (state.version !== 1 || !state.deviceId || !state.credentialId) {
          throw new Error('Local encryption state has an unsupported format');
        }
        this.provider = module.Provider.import_state(base64ToBytes(state.provider));
        this.identity = module.Identity.import_state(this.provider, base64ToBytes(state.identity));
        this.state = state;
      } else {
        const deviceId = crypto.randomUUID();
        const credentialId = `user:${userId}:device:${deviceId}`;
        this.provider = new module.Provider();
        this.identity = new module.Identity(this.provider, credentialId);
        this.state = { version: 1, deviceId, credentialId, provider: '', identity: '' };
      }
      this.module = module;
      await this.persist();
      await this.publishFreshKeyPackage();
    });
  }

  close(userId: number): Promise<void> {
    return this.run(async () => {
      if (this.userId === userId) this.dispose();
    });
  }

  private requireReady(): {
    module: MlsModule;
    provider: MlsProvider;
    identity: MlsIdentity;
    state: PersistedState;
    userId: number;
  } {
    if (!this.module || !this.provider || !this.identity || !this.state || this.userId === null) {
      throw new Error('Secret chat is not initialized');
    }
    return {
      module: this.module, provider: this.provider, identity: this.identity,
      state: this.state, userId: this.userId,
    };
  }

  private async persist(): Promise<void> {
    const { provider, identity, state, userId } = this.requireReady();
    state.provider = bytesToBase64(provider.export_state());
    state.identity = bytesToBase64(identity.export_state());
    await saveSecretState(userId, JSON.stringify(state));
  }

  private async publishFreshKeyPackage(): Promise<void> {
    const { provider, identity, state } = this.requireReady();
    await secretDmApi.registerDevice({
      device_id: state.deviceId,
      credential_id: state.credentialId,
      key_package: bytesToBase64(identity.key_package(provider)),
      signature_public_key: bytesToBase64(identity.signature_public_key()),
    });
    await this.persist();
  }

  async refreshKeyPackage(userId: number): Promise<void> {
    await this.initialize(userId);
    return this.run(() => this.publishFreshKeyPackage());
  }

  private loadGroup(sessionId: string): MlsGroup {
    const { module, provider } = this.requireReady();
    return module.Group.load(provider, encoder.encode(sessionId));
  }

  private async openExisting(peerId: number, descriptor: SecretSession): Promise<ActiveSession> {
    const { module, provider, state, userId } = this.requireReady();
    if (!descriptor.device_matches || descriptor.local_device_id !== state.deviceId) {
      throw new Error('Encryption device changed. Reset the secret chat to continue.');
    }
    let group: MlsGroup;
    try {
      group = this.loadGroup(descriptor.session_id);
    } catch (error) {
      if (descriptor.founder_user_id === userId) {
        throw new Error('The founder encryption state is missing on this device. Reset the secret chat.');
      }
      group = module.Group.join(
        provider,
        base64ToBytes(descriptor.welcome),
        base64ToBytes(descriptor.ratchet_tree),
      );
      await this.persist();
      await this.publishFreshKeyPackage();
    }
    const active = { descriptor, group };
    this.sessions.set(peerId, active);
    return active;
  }

  private async createSession(peerId: number, peer: E2eeDevice): Promise<ActiveSession> {
    const { module, provider, identity, state } = this.requireReady();
    const sessionId = crypto.randomUUID();
    const group = module.Group.create(provider, identity, encoder.encode(sessionId));
    let transition: ReturnType<MlsGroup['add_member']> | undefined;
    try {
      transition = group.add_member(provider, identity, base64ToBytes(peer.key_package));
      const descriptor = await secretDmApi.createSession(peerId, {
        session_id: sessionId,
        founder_device_id: state.deviceId,
        recipient_device_id: peer.device_id,
        recipient_key_package_id: peer.key_package_id,
        welcome: bytesToBase64(transition.welcome),
        ratchet_tree: bytesToBase64(transition.ratchet_tree),
      });
      await this.persist();
      const active = { descriptor, group };
      this.sessions.set(peerId, active);
      return active;
    } catch (error) {
      group.free();
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const existing = await secretDmApi.session(peerId);
        if (existing) return this.openExisting(peerId, existing);
      }
      throw new Error(apiMessage(error));
    } finally {
      transition?.free();
    }
  }

  private async ensureSession(peerId: number): Promise<ActiveSession> {
    const cached = this.sessions.get(peerId);
    if (cached) return cached;
    const existing = await secretDmApi.session(peerId);
    if (existing) return this.openExisting(peerId, existing);
    return this.createSession(peerId, await secretDmApi.peerDevice(peerId));
  }

  encrypt(peerId: number, plaintext: string, clientNonce: string): Promise<{
    ciphertext: string;
    sessionId: string;
    senderDeviceId: string;
  }> {
    return this.run(async () => {
      const { provider, identity, state, userId } = this.requireReady();
      const session = await this.ensureSession(peerId);
      const ciphertext = session.group.encrypt_message(provider, identity, encoder.encode(plaintext));
      await this.persist();
      await saveSecretPlaintext(userId, `nonce:${clientNonce}`, plaintext);
      return {
        ciphertext: bytesToBase64(ciphertext),
        sessionId: session.descriptor.session_id,
        senderDeviceId: state.deviceId,
      };
    });
  }

  decrypt(peerId: number, wire: SecretWireMessage): Promise<DecryptedSecretMessage> {
    return this.run(async () => {
      const { provider, userId } = this.requireReady();
      const cached = await loadSecretPlaintext(userId, `id:${wire.id}`)
        || (wire.client_nonce ? await loadSecretPlaintext(userId, `nonce:${wire.client_nonce}`) : null);
      if (cached !== null) {
        await saveSecretPlaintext(userId, `id:${wire.id}`, cached);
        return { ...wire, content: cached };
      }
      if (wire.sender_id === userId) {
        return { ...wire, content: '', decryptError: 'Message was sent from another local state and cannot be restored.' };
      }
      const session = await this.ensureSession(peerId);
      if (wire.secret_session_id !== session.descriptor.session_id) {
        return { ...wire, content: '', decryptError: 'Message belongs to an older secret session.' };
      }
      try {
        const content = decoder.decode(session.group.decrypt_message(provider, base64ToBytes(wire.ciphertext)));
        await this.persist();
        await saveSecretPlaintext(userId, `id:${wire.id}`, content);
        return { ...wire, content };
      } catch {
        return { ...wire, content: '', decryptError: 'Ciphertext authentication failed.' };
      }
    });
  }

  safetyCode(peerId: number): Promise<string> {
    return this.run(async () => {
      const { identity } = this.requireReady();
      const session = await this.ensureSession(peerId);
      const peer = await secretDmApi.peerDevice(peerId);
      const keys = [bytesToBase64(identity.signature_public_key()), peer.signature_public_key].sort();
      const material = `${session.descriptor.session_id}:${keys.join(':')}`;
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(material)));
      return Array.from(digest.subarray(0, 12), (byte) => byte.toString(16).padStart(2, '0'))
        .join('').toUpperCase().match(/.{1,4}/g)!.join('-');
    });
  }

  reset(peerId: number): Promise<void> {
    return this.run(async () => {
      await secretDmApi.resetSession(peerId);
      this.sessions.get(peerId)?.group.free();
      this.sessions.delete(peerId);
    });
  }

  forgetSession(peerId: number): Promise<void> {
    return this.run(async () => {
      this.sessions.get(peerId)?.group.free();
      this.sessions.delete(peerId);
    });
  }
}

export const secretDmCrypto = new SecretDmCrypto();
