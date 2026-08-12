import type WebSocket from 'ws';

export const E2EE_PROTOCOL_VERSION = 1;
export const E2EE_HANDSHAKE_TIMEOUT_MS = 15_000;
const MAX_KEY_PACKAGE_BYTES = 16 * 1024;
const MAX_COMMIT_BYTES = 128 * 1024;
const MAX_WELCOME_BYTES = 256 * 1024;
const MAX_TREE_BYTES = 512 * 1024;
const MAX_BOT_PUBLIC_KEY_BYTES = 512;
const MAX_BOT_ENVELOPE_FIELD_BYTES = 4 * 1024;

export interface E2eeHello {
  protocol_version: number;
  credential_id: string;
  key_package: string;
}

export interface E2eePeer {
  sessionId: string;
  credentialId: string;
  keyPackage: string;
  socket: WebSocket;
  readyEpoch?: bigint;
}

export interface E2eeBotHello {
  protocol_version: number;
  credential_id: string;
  public_key: string;
}

export interface E2eeBotEndpoint {
  session_id: string;
  credential_id: string;
  public_key: string;
}

type E2eeBot = E2eeBotEndpoint & { readyEpoch?: bigint };

export interface E2eeCoordinatorCallbacks {
  send(sessionId: string, type: string, data: Record<string, unknown>): void;
  sendBot(sessionId: string, type: string, data: Record<string, unknown>): void;
  setTransitioning(transitioning: boolean): Promise<void>;
  disconnectAll(reason: string): void;
}

type PendingTransition = {
  kind: 'bootstrap' | 'add' | 'remove' | 'rotate';
  targetSessionId: string;
  targetCredentialId: string;
  awaiting: Set<string>;
  nextEpoch?: bigint;
  timer: ReturnType<typeof setTimeout>;
};

type BotMutation = {
  kind: 'add' | 'remove';
  sessionId: string;
  credentialId: string;
};

function decodeBase64(value: unknown, label: string, maxBytes: number): Buffer {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error(`${label} must be base64`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || decoded.length > maxBytes) throw new Error(`${label} has an invalid size`);
  if (decoded.toString('base64') !== value) throw new Error(`${label} is not canonical base64`);
  return decoded;
}

function parseEpoch(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) {
    throw new Error('MLS epoch must be an unsigned decimal string');
  }
  const epoch = BigInt(value);
  if (epoch > 0xffff_ffff_ffff_ffffn) throw new Error('MLS epoch is out of range');
  return epoch;
}

export class E2eeCoordinator {
  private readonly peers = new Map<string, E2eePeer>();
  private readonly bots = new Map<string, E2eeBot>();
  private readonly joinQueue: string[] = [];
  private readonly botQueue: BotMutation[] = [];
  private leaderSessionId?: string;
  private activeEpoch?: bigint;
  private pending?: PendingTransition;
  private failed = false;

  constructor(
    private readonly groupId: string,
    private readonly callbacks: E2eeCoordinatorCallbacks,
  ) {}

  hasMembers(): boolean {
    return this.peers.size > 0;
  }

  isReady(sessionId: string): boolean {
    const peer = this.peers.get(sessionId);
    return Boolean(peer && this.activeEpoch !== undefined && peer.readyEpoch === this.activeEpoch && !this.pending);
  }

  isBotReady(sessionId: string): boolean {
    const bot = this.bots.get(sessionId);
    return Boolean(bot && this.activeEpoch !== undefined && bot.readyEpoch === this.activeEpoch && !this.pending);
  }

  botEndpoints(): E2eeBotEndpoint[] {
    return [...this.bots.values()].map(({ session_id, credential_id, public_key }) => ({
      session_id, credential_id, public_key,
    }));
  }

  register(
    sessionId: string,
    expectedCredentialId: string,
    socket: WebSocket,
    hello: E2eeHello,
  ): Record<string, unknown> {
    if (this.failed) throw new Error('Encrypted room must be re-created');
    if (hello.protocol_version !== E2EE_PROTOCOL_VERSION) throw new Error('E2EE protocol v1 is required');
    if (hello.credential_id !== expectedCredentialId) throw new Error('E2EE credential scope mismatch');
    if (hello.credential_id.length > 192) throw new Error('E2EE credential is too long');
    decodeBase64(hello.key_package, 'MLS key package', MAX_KEY_PACKAGE_BYTES);
    if (this.peers.has(sessionId)) throw new Error('E2EE session is already registered');

    this.peers.set(sessionId, {
      sessionId,
      credentialId: hello.credential_id,
      keyPackage: hello.key_package,
      socket,
    });
    if (!this.leaderSessionId && this.activeEpoch === undefined && !this.pending) {
      this.leaderSessionId = sessionId;
      this.pending = this.createPending('bootstrap', sessionId, hello.credential_id, [sessionId]);
      void this.callbacks.setTransitioning(true).catch((error) => this.failClosed(String(error)));
      return {
        protocol_version: E2EE_PROTOCOL_VERSION,
        action: 'create',
        group_id: Buffer.from(this.groupId).toString('base64'),
        credential_id: hello.credential_id,
      };
    }

    this.joinQueue.push(sessionId);
    void this.startNextTransition();
    return {
      protocol_version: E2EE_PROTOCOL_VERSION,
      action: 'wait',
      credential_id: hello.credential_id,
    };
  }

  registerBot(sessionId: string, expectedCredentialId: string, hello: E2eeBotHello): void {
    if (this.failed) throw new Error('Encrypted room must be re-created');
    if (hello.protocol_version !== E2EE_PROTOCOL_VERSION) throw new Error('Bot E2EE protocol v1 is required');
    if (hello.credential_id !== expectedCredentialId) throw new Error('Bot E2EE credential scope mismatch');
    if (hello.credential_id.length > 192) throw new Error('Bot E2EE credential is too long');
    decodeBase64(hello.public_key, 'Bot E2EE public key', MAX_BOT_PUBLIC_KEY_BYTES);
    if (this.bots.has(sessionId)) throw new Error('Bot E2EE session is already registered');
    this.bots.set(sessionId, {
      session_id: sessionId,
      credential_id: hello.credential_id,
      public_key: hello.public_key,
    });
    this.botQueue.push({ kind: 'add', sessionId, credentialId: hello.credential_id });
    void this.startNextTransition();
  }

  async unregisterBot(sessionId: string): Promise<void> {
    const bot = this.bots.get(sessionId);
    if (!bot) return;
    this.bots.delete(sessionId);
    const queued = this.botQueue.findIndex((item) => item.sessionId === sessionId && item.kind === 'add');
    if (queued >= 0) this.botQueue.splice(queued, 1);
    if (this.failed || bot.readyEpoch === undefined || this.activeEpoch === undefined) return;
    if (this.pending) {
      this.failClosed('A bot left during an MLS epoch transition');
      return;
    }
    this.botQueue.push({ kind: 'remove', sessionId, credentialId: bot.credential_id });
    await this.startNextTransition();
  }

  async unregister(sessionId: string): Promise<void> {
    const peer = this.peers.get(sessionId);
    if (!peer) return;
    this.peers.delete(sessionId);
    if (this.failed) return;
    const queueIndex = this.joinQueue.indexOf(sessionId);
    if (queueIndex >= 0) this.joinQueue.splice(queueIndex, 1);

    if (this.pending) {
      if (this.pending.kind === 'add' && this.pending.targetSessionId === sessionId && !this.pending.nextEpoch) {
        this.clearPending();
        await this.callbacks.setTransitioning(false);
        await this.startNextTransition();
        return;
      }
      this.failClosed('A participant left during an MLS epoch transition');
      return;
    }
    if (peer.readyEpoch === undefined || this.activeEpoch === undefined) return;
    if (!this.peers.size) {
      this.leaderSessionId = undefined;
      this.activeEpoch = undefined;
      await this.callbacks.setTransitioning(false);
      return;
    }

    if (this.leaderSessionId === sessionId) this.leaderSessionId = this.firstReadySession();
    const leader = this.requireLeader();
    this.pending = this.createPending('remove', sessionId, peer.credentialId, []);
    await this.callbacks.setTransitioning(true);
    this.callbacks.send(leader.sessionId, 'e2ee_remove_member', {
      credential_id: peer.credentialId,
      current_epoch: this.activeEpoch.toString(),
      bots: this.botEndpoints(),
    });
  }

  async commitAdd(
    senderSessionId: string,
    targetSessionId: unknown,
    epochValue: unknown,
    commit: unknown,
    welcome: unknown,
    ratchetTree: unknown,
    botEnvelopes?: unknown,
  ): Promise<void> {
    const pending = this.requirePending('add', senderSessionId);
    if (targetSessionId !== pending.targetSessionId) throw new Error('MLS add target mismatch');
    decodeBase64(commit, 'MLS commit', MAX_COMMIT_BYTES);
    decodeBase64(welcome, 'MLS Welcome', MAX_WELCOME_BYTES);
    decodeBase64(ratchetTree, 'MLS ratchet tree', MAX_TREE_BYTES);
    const epoch = this.requireNextEpoch(epochValue);
    pending.nextEpoch = epoch;
    const recipients = this.readySessions().filter((id) => id !== senderSessionId);
    pending.awaiting = new Set([...recipients, pending.targetSessionId]);
    this.addBotEnvelopes(pending, epoch, botEnvelopes);
    this.peers.get(senderSessionId)!.readyEpoch = epoch;
    for (const sessionId of recipients) {
      this.callbacks.send(sessionId, 'e2ee_commit', { commit, epoch: epoch.toString() });
    }
    this.callbacks.send(pending.targetSessionId, 'e2ee_welcome', {
      welcome,
      ratchet_tree: ratchetTree,
      epoch: epoch.toString(),
    });
    await this.finishIfReady();
  }

  async commitRemove(
    senderSessionId: string,
    credentialId: unknown,
    epochValue: unknown,
    commit: unknown,
    botEnvelopes?: unknown,
  ): Promise<void> {
    const pending = this.requirePending('remove', senderSessionId);
    if (credentialId !== pending.targetCredentialId) throw new Error('MLS remove target mismatch');
    decodeBase64(commit, 'MLS commit', MAX_COMMIT_BYTES);
    const epoch = this.requireNextEpoch(epochValue);
    pending.nextEpoch = epoch;
    const recipients = this.readySessions().filter((id) => id !== senderSessionId);
    pending.awaiting = new Set(recipients);
    this.addBotEnvelopes(pending, epoch, botEnvelopes);
    this.peers.get(senderSessionId)!.readyEpoch = epoch;
    for (const sessionId of recipients) {
      this.callbacks.send(sessionId, 'e2ee_commit', { commit, epoch: epoch.toString() });
    }
    await this.finishIfReady();
  }

  async commitRotate(
    senderSessionId: string,
    targetSessionId: unknown,
    epochValue: unknown,
    commit: unknown,
    botEnvelopes: unknown,
  ): Promise<void> {
    const pending = this.requirePending('rotate', senderSessionId);
    if (targetSessionId !== pending.targetSessionId) throw new Error('MLS rotate target mismatch');
    decodeBase64(commit, 'MLS commit', MAX_COMMIT_BYTES);
    const epoch = this.requireNextEpoch(epochValue);
    pending.nextEpoch = epoch;
    const recipients = this.readySessions().filter((id) => id !== senderSessionId);
    pending.awaiting = new Set(recipients);
    this.addBotEnvelopes(pending, epoch, botEnvelopes);
    this.peers.get(senderSessionId)!.readyEpoch = epoch;
    for (const sessionId of recipients) {
      this.callbacks.send(sessionId, 'e2ee_commit', { commit, epoch: epoch.toString() });
    }
    await this.finishIfReady();
  }

  async epochReady(sessionId: string, epochValue: unknown): Promise<void> {
    const pending = this.pending;
    if (!pending) throw new Error('No MLS epoch transition is active');
    const epoch = parseEpoch(epochValue);
    if (pending.kind === 'bootstrap') {
      if (sessionId !== pending.targetSessionId || epoch !== 0n) throw new Error('Invalid MLS bootstrap epoch');
      pending.nextEpoch = epoch;
    } else if (pending.nextEpoch !== epoch) {
      throw new Error('MLS epoch acknowledgement mismatch');
    }
    const peer = this.peers.get(sessionId);
    if (!peer) throw new Error('E2EE peer is unavailable');
    peer.readyEpoch = epoch;
    pending.awaiting.delete(sessionId);
    await this.finishIfReady();
  }

  async botEpochReady(sessionId: string, epochValue: unknown): Promise<void> {
    const pending = this.pending;
    const bot = this.bots.get(sessionId);
    if (!pending || !bot) throw new Error('No bot MLS transition is active');
    const epoch = parseEpoch(epochValue);
    if (pending.nextEpoch !== epoch || !pending.awaiting.delete(`bot:${sessionId}`)) {
      throw new Error('Bot MLS epoch acknowledgement mismatch');
    }
    bot.readyEpoch = epoch;
    await this.finishIfReady();
  }

  close(): void {
    this.clearPending();
    this.peers.clear();
    this.bots.clear();
    this.joinQueue.length = 0;
    this.botQueue.length = 0;
  }

  private async startNextTransition(): Promise<void> {
    if (this.failed || this.pending || this.activeEpoch === undefined) return;
    let sessionId = this.joinQueue.shift();
    while (sessionId && !this.peers.has(sessionId)) sessionId = this.joinQueue.shift();
    const leader = this.requireLeader();
    if (sessionId) {
      const target = this.peers.get(sessionId)!;
      this.pending = this.createPending('add', sessionId, target.credentialId, []);
      await this.callbacks.setTransitioning(true);
      this.callbacks.send(leader.sessionId, 'e2ee_add_member', {
        session_id: sessionId,
        credential_id: target.credentialId,
        key_package: target.keyPackage,
        current_epoch: this.activeEpoch.toString(),
        bots: this.botEndpoints(),
      });
      return;
    }
    let mutation = this.botQueue.shift();
    while (mutation && mutation.kind === 'add' && !this.bots.has(mutation.sessionId)) {
      mutation = this.botQueue.shift();
    }
    if (!mutation) return;
    this.pending = this.createPending(
      'rotate', mutation.sessionId, mutation.credentialId, [],
    );
    await this.callbacks.setTransitioning(true);
    this.callbacks.send(leader.sessionId, 'e2ee_rotate_epoch', {
      reason: mutation.kind === 'add' ? 'bot_join' : 'bot_leave',
      target_session_id: mutation.sessionId,
      current_epoch: this.activeEpoch.toString(),
      bots: this.botEndpoints(),
    });
  }

  private async finishIfReady(): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.nextEpoch === undefined || pending.awaiting.size) return;
    this.activeEpoch = pending.nextEpoch;
    if (pending.kind === 'add' || pending.kind === 'bootstrap') {
      const target = this.peers.get(pending.targetSessionId);
      if (target) target.readyEpoch = this.activeEpoch;
    }
    this.clearPending();
    await this.callbacks.setTransitioning(false);
    for (const peer of this.peers.values()) {
      if (peer.readyEpoch === this.activeEpoch) {
        this.callbacks.send(peer.sessionId, 'e2ee_epoch_active', {
          protocol_version: E2EE_PROTOCOL_VERSION,
          epoch: this.activeEpoch.toString(),
          leader_session_id: this.leaderSessionId,
        });
      }
    }
    for (const bot of this.bots.values()) {
      if (bot.readyEpoch === this.activeEpoch) {
        this.callbacks.sendBot(bot.session_id, 'e2ee_epoch_active', {
          protocol_version: E2EE_PROTOCOL_VERSION,
          epoch: this.activeEpoch.toString(),
        });
      }
    }
    await this.startNextTransition();
  }

  private requirePending(kind: 'add' | 'remove' | 'rotate', senderSessionId: string): PendingTransition {
    if (!this.pending || this.pending.kind !== kind) throw new Error(`No MLS ${kind} transition is active`);
    if (senderSessionId !== this.leaderSessionId) throw new Error('Only the MLS leader can commit membership');
    if (this.pending.nextEpoch !== undefined) throw new Error('MLS transition was already committed');
    return this.pending;
  }

  private requireNextEpoch(value: unknown): bigint {
    if (this.activeEpoch === undefined) throw new Error('MLS group is not active');
    const epoch = parseEpoch(value);
    if (epoch !== this.activeEpoch + 1n) throw new Error('MLS commit did not advance exactly one epoch');
    return epoch;
  }

  private requireLeader(): E2eePeer {
    const leader = this.leaderSessionId ? this.peers.get(this.leaderSessionId) : undefined;
    if (!leader || leader.readyEpoch !== this.activeEpoch) throw new Error('MLS leader is unavailable');
    return leader;
  }

  private firstReadySession(): string | undefined {
    return this.readySessions()[0];
  }

  private readySessions(): string[] {
    return [...this.peers.values()]
      .filter((peer) => peer.readyEpoch === this.activeEpoch)
      .map((peer) => peer.sessionId);
  }

  private addBotEnvelopes(
    pending: PendingTransition,
    epoch: bigint,
    rawEnvelopes: unknown,
  ): void {
    const envelopes = rawEnvelopes ?? [];
    if (!Array.isArray(envelopes)) throw new Error('Bot E2EE envelopes must be an array');
    if (envelopes.length !== this.bots.size) throw new Error('Bot E2EE envelope set is incomplete');
    const remaining = new Set(this.bots.keys());
    for (const raw of envelopes) {
      if (!raw || typeof raw !== 'object') throw new Error('Bot E2EE envelope is invalid');
      const envelope = raw as Record<string, unknown>;
      const sessionId = String(envelope.session_id ?? '');
      const bot = this.bots.get(sessionId);
      if (!bot || !remaining.delete(sessionId)) throw new Error('Bot E2EE envelope target mismatch');
      if (envelope.credential_id !== bot.credential_id) {
        throw new Error('Bot E2EE envelope credential mismatch');
      }
      for (const field of ['ephemeral_key', 'salt', 'iv', 'ciphertext'] as const) {
        decodeBase64(envelope[field], `Bot E2EE envelope ${field}`, MAX_BOT_ENVELOPE_FIELD_BYTES);
      }
      pending.awaiting.add(`bot:${sessionId}`);
      this.callbacks.sendBot(sessionId, 'e2ee_prepare_epoch', {
        protocol_version: E2EE_PROTOCOL_VERSION,
        epoch: epoch.toString(),
        credential_id: bot.credential_id,
        ephemeral_key: envelope.ephemeral_key,
        salt: envelope.salt,
        iv: envelope.iv,
        ciphertext: envelope.ciphertext,
      });
    }
  }

  private createPending(
    kind: PendingTransition['kind'],
    targetSessionId: string,
    targetCredentialId: string,
    awaiting: string[],
  ): PendingTransition {
    const timer = setTimeout(() => this.onTimeout(kind, targetSessionId), E2EE_HANDSHAKE_TIMEOUT_MS);
    timer.unref?.();
    return { kind, targetSessionId, targetCredentialId, awaiting: new Set(awaiting), timer };
  }

  private clearPending(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = undefined;
  }

  private onTimeout(kind: PendingTransition['kind'], targetSessionId: string): void {
    if (this.pending?.kind !== kind || this.pending.targetSessionId !== targetSessionId) return;
    if (kind === 'add' && this.pending.nextEpoch === undefined) {
      const target = this.peers.get(targetSessionId);
      this.peers.delete(targetSessionId);
      this.clearPending();
      try { target?.socket.close(4020, 'MLS join timed out'); } catch { /* already closed */ }
      void this.callbacks.setTransitioning(false).then(() => this.startNextTransition())
        .catch((error) => this.failClosed(String(error)));
      return;
    }
    this.failClosed('MLS epoch transition timed out');
  }

  private failClosed(reason: string): void {
    if (this.failed) return;
    this.failed = true;
    this.clearPending();
    this.callbacks.disconnectAll(reason);
  }
}
