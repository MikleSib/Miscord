import type { MediaRpcClient } from '../mediaRpcClient';
import type { MediaSource } from '../types';
import { sealBotEpochSecrets, type BotE2eeEndpoint } from './botEnvelope';
import { assertEncodedTransformSupport, attachReceiverTransform, attachSenderTransform } from './encodedTransform';
import { base64ToBytes, bytesToBase64, loadMlsModule } from './mlsRuntime';
import type { MlsGroup, MlsIdentity, MlsModule, MlsProvider } from './mlsTypes';

type IdentifyE2ee = {
  protocol_version: number;
  action: 'create' | 'wait';
  group_id?: string;
  credential_id: string;
};

type Deferred = { promise: Promise<void>; resolve(): void; reject(error: Error): void };

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

export class VoiceE2EE {
  private module?: MlsModule;
  private provider?: MlsProvider;
  private identity?: MlsIdentity;
  private group?: MlsGroup;
  private readonly worker: Worker;
  private readonly initialGroup = deferred();
  private readonly activeWaiters = new Map<string, Deferred>();
  private readonly keyWaiters = new Map<string, Deferred>();
  private activeEpoch?: string;
  private eventTail = Promise.resolve();
  private failed?: Error;
  private requestSequence = 0;
  private failureHandler?: (message: string) => void;
  private epochHandler?: (verificationCode?: string) => void;

  constructor(
    private readonly rpc: MediaRpcClient,
    readonly credentialId: string,
  ) {
    assertEncodedTransformSupport();
    this.worker = new Worker('/voice/e2ee-worker.js');
    this.worker.addEventListener('message', (event) => this.handleWorkerMessage(event.data));
    this.worker.addEventListener('error', () => this.fail(new Error('Модуль шифрования медиаданных остановлен.')));
    void this.initialGroup.promise.catch(() => undefined);
    for (const type of [
      'e2ee_add_member', 'e2ee_remove_member', 'e2ee_rotate_epoch',
      'e2ee_commit', 'e2ee_welcome',
    ]) {
      this.rpc.on(type, (payload) => this.enqueue(type, payload));
    }
    this.rpc.on('e2ee_epoch_active', (payload) => {
      const epoch = String(payload.epoch);
      this.activeEpoch = epoch;
      this.epochHandler?.(this.verificationCode());
      this.activeWaiters.get(epoch)?.resolve();
      this.activeWaiters.delete(epoch);
    });
  }

  async hello(): Promise<Record<string, unknown>> {
    this.module = await loadMlsModule();
    this.provider = new this.module.Provider();
    this.identity = new this.module.Identity(this.provider, this.credentialId);
    return {
      protocol_version: 1,
      credential_id: this.credentialId,
      key_package: bytesToBase64(this.identity.key_package(this.provider)),
    };
  }

  async activate(details: IdentifyE2ee): Promise<void> {
    this.assertRuntime();
    if (details.protocol_version !== 1 || details.credential_id !== this.credentialId) {
      throw new Error('Сервер вернул несовместимый E2EE-сеанс.');
    }
    if (details.action === 'create') {
      if (!details.group_id) throw new Error('MLS group id отсутствует.');
      this.group = this.module!.Group.create(
        this.provider!, this.identity!, base64ToBytes(details.group_id),
      );
      const secret = await this.installEpochKeys();
      secret.fill(0);
      this.initialGroup.resolve();
      const epoch = this.group.epoch().toString();
      const active = this.waitForActiveEpoch(epoch);
      await this.rpc.request('e2ee_epoch_ready', { epoch });
      await active;
      return;
    }
    if (details.action !== 'wait') throw new Error('Неизвестное MLS-действие.');
    await this.initialGroup.promise;
    this.assertHealthy();
    const epoch = this.group!.epoch().toString();
    await this.waitForActiveEpoch(epoch);
  }

  protectSender(sender: RTCRtpSender | undefined, source: MediaSource): void {
    this.assertHealthy();
    if (!this.activeEpoch) throw new Error('MLS epoch ещё не активен.');
    attachSenderTransform(sender, this.worker, this.credentialId, source);
  }

  protectReceiver(
    receiver: RTCRtpReceiver | undefined,
    senderCredentialId: string,
    source: MediaSource,
  ): void {
    this.assertHealthy();
    if (!senderCredentialId) throw new Error('Отправитель E2EE не подтверждён.');
    attachReceiverTransform(receiver, this.worker, senderCredentialId, source);
  }

  verificationCode(): string | undefined {
    if (!this.group || !this.provider) return undefined;
    const raw = this.group.export_key(
      this.provider, 'miscord verification v1', new Uint8Array(), 16,
    );
    return [...raw].map((item) => item.toString(16).padStart(2, '0')).join('')
      .match(/.{1,4}/g)?.join(' ').toUpperCase();
  }

  onFailure(handler: (message: string) => void): void {
    this.failureHandler = handler;
  }

  onEpochActive(handler: (verificationCode?: string) => void): void {
    this.epochHandler = handler;
  }

  close(): void {
    this.failureHandler = undefined;
    this.epochHandler = undefined;
    this.worker.terminate();
    this.group?.free();
    this.identity?.free();
    this.provider?.free();
    this.group = undefined;
    this.identity = undefined;
    this.provider = undefined;
    this.fail(new Error('E2EE-сеанс закрыт.'));
  }

  private enqueue(type: string, payload: any): void {
    this.eventTail = this.eventTail
      .then(() => this.handleEvent(type, payload))
      .catch((error) => this.fail(error instanceof Error ? error : new Error(String(error))));
  }

  private async handleEvent(type: string, payload: any): Promise<void> {
    this.assertRuntime();
    if (type === 'e2ee_add_member') {
      await this.initialGroup.promise;
      const transition = this.group!.add_member(
        this.provider!, this.identity!, base64ToBytes(String(payload.key_package)),
      );
      let secret: Uint8Array | undefined;
      try {
        secret = await this.installEpochKeys();
        const botEnvelopes = await this.botEnvelopes(payload.bots, transition.epoch, secret);
        await this.rpc.request('e2ee_commit_add', {
          target_session_id: String(payload.session_id),
          epoch: transition.epoch.toString(),
          commit: bytesToBase64(transition.commit),
          welcome: bytesToBase64(transition.welcome),
          ratchet_tree: bytesToBase64(transition.ratchet_tree),
          bot_envelopes: botEnvelopes,
        });
      } finally {
        secret?.fill(0);
        transition.free();
      }
      return;
    }
    if (type === 'e2ee_remove_member') {
      await this.initialGroup.promise;
      const credentialId = String(payload.credential_id);
      const transition = this.group!.remove_member(this.provider!, this.identity!, credentialId);
      let secret: Uint8Array | undefined;
      try {
        secret = await this.installEpochKeys();
        const botEnvelopes = await this.botEnvelopes(payload.bots, transition.epoch, secret);
        await this.rpc.request('e2ee_commit_remove', {
          credential_id: credentialId,
          epoch: transition.epoch.toString(),
          commit: bytesToBase64(transition.commit),
          bot_envelopes: botEnvelopes,
        });
      } finally {
        secret?.fill(0);
        transition.free();
      }
      return;
    }
    if (type === 'e2ee_rotate_epoch') {
      await this.initialGroup.promise;
      const transition = this.group!.rotate_epoch(this.provider!, this.identity!);
      let secret: Uint8Array | undefined;
      try {
        secret = await this.installEpochKeys();
        const botEnvelopes = await this.botEnvelopes(payload.bots, transition.epoch, secret);
        await this.rpc.request('e2ee_commit_rotate', {
          target_session_id: String(payload.target_session_id ?? ''),
          epoch: transition.epoch.toString(),
          commit: bytesToBase64(transition.commit),
          bot_envelopes: botEnvelopes,
        });
      } finally {
        secret?.fill(0);
        transition.free();
      }
      return;
    }
    if (type === 'e2ee_commit') {
      await this.initialGroup.promise;
      this.group!.process_commit(this.provider!, base64ToBytes(String(payload.commit)));
      const secret = await this.installEpochKeys();
      secret.fill(0);
      await this.rpc.request('e2ee_epoch_ready', { epoch: this.group!.epoch().toString() });
      return;
    }
    if (type === 'e2ee_welcome') {
      if (this.group) throw new Error('Duplicate MLS Welcome rejected.');
      this.group = this.module!.Group.join(
        this.provider!, base64ToBytes(String(payload.welcome)),
        base64ToBytes(String(payload.ratchet_tree)),
      );
      const secret = await this.installEpochKeys();
      secret.fill(0);
      this.initialGroup.resolve();
      await this.rpc.request('e2ee_epoch_ready', { epoch: this.group.epoch().toString() });
    }
  }

  private async installEpochKeys(): Promise<Uint8Array> {
    if (!this.group || !this.provider) throw new Error('MLS group is unavailable.');
    const epoch = this.group.epoch().toString();
    const secret = this.group.export_key(
      this.provider, 'miscord media root v1', new TextEncoder().encode(epoch), 32,
    );
    const requestId = `keys-${++this.requestSequence}`;
    const waiter = deferred();
    this.keyWaiters.set(requestId, waiter);
    const buffer = secret.slice().buffer;
    this.worker.postMessage({ type: 'install-keys', requestId, epoch, secret: buffer }, [buffer]);
    await waiter.promise;
    return secret;
  }

  private async botEnvelopes(
    endpoints: BotE2eeEndpoint[] | undefined,
    epoch: bigint,
    secret: Uint8Array,
  ) {
    return sealBotEpochSecrets(endpoints, epoch.toString(), secret);
  }

  private handleWorkerMessage(payload: any): void {
    if (payload?.type === 'keys-installed') {
      this.keyWaiters.get(String(payload.requestId))?.resolve();
      this.keyWaiters.delete(String(payload.requestId));
    } else if (payload?.type === 'e2ee-error') {
      this.fail(new Error(`Ошибка E2EE: ${String(payload.message)}`));
    }
  }

  private waitForActiveEpoch(epoch: string): Promise<void> {
    if (this.activeEpoch === epoch) return Promise.resolve();
    const waiter = this.activeWaiters.get(epoch) ?? deferred();
    this.activeWaiters.set(epoch, waiter);
    return waiter.promise;
  }

  private assertRuntime(): void {
    if (!this.module || !this.provider || !this.identity) throw new Error('MLS runtime не инициализирован.');
    this.assertHealthy();
  }

  private assertHealthy(): void {
    if (this.failed) throw this.failed;
  }

  private fail(error: Error): void {
    if (this.failed) return;
    this.failed = error;
    this.failureHandler?.(error.message);
    this.initialGroup.reject(error);
    for (const waiter of this.activeWaiters.values()) waiter.reject(error);
    for (const waiter of this.keyWaiters.values()) waiter.reject(error);
    this.activeWaiters.clear();
    this.keyWaiters.clear();
  }
}
