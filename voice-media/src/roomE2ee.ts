import {
  E2eeCoordinator, E2EE_PROTOCOL_VERSION, type E2eeBotHello, type E2eeHello,
} from './e2eeCoordinator.js';
import type { Peer } from './room.js';
import type { MediaSource, RpcRequest } from './types.js';

export class RoomE2ee {
  private readonly coordinator: E2eeCoordinator;
  private readonly botSenders = new Map<string, (op: number, data: Record<string, unknown>) => void>();
  transitioning = false;

  constructor(
    channelId: number,
    epoch: string,
    private readonly peers: Map<string, Peer>,
  ) {
    this.coordinator = new E2eeCoordinator(`miscord-voice:${channelId}:${epoch}`, {
      send: (sessionId, type, data) => {
        const peer = this.peers.get(sessionId);
        if (peer && !peer.claims.is_bot && peer.socket.readyState === peer.socket.OPEN) {
          peer.socket.send(JSON.stringify({ type, ...data }));
        }
      },
      sendBot: (sessionId, type, data) => {
        const sender = this.botSenders.get(sessionId);
        if (!sender) return;
        if (type === 'e2ee_prepare_epoch') sender(24, data);
        else if (type === 'e2ee_epoch_active') {
          sender(22, {
            transition_id: data.epoch,
            dave_protocol_version: E2EE_PROTOCOL_VERSION,
          });
        }
      },
      setTransitioning: (transitioning) => this.setTransitioning(transitioning),
      disconnectAll: (reason) => {
        for (const peer of this.peers.values()) {
          if (!peer.claims.is_bot) {
            try { peer.socket.close(4021, reason); } catch { /* already closed */ }
          }
        }
      },
    });
  }

  hasMembers(): boolean {
    return this.coordinator.hasMembers();
  }

  isReady(sessionId: string): boolean {
    return this.coordinator.isReady(sessionId);
  }

  isBotReady(sessionId: string): boolean {
    return this.coordinator.isBotReady(sessionId);
  }

  register(peer: Peer, hello: E2eeHello): Record<string, unknown> {
    if (peer.claims.is_bot) throw new Error('Human E2EE registration required');
    const credentialId = `${peer.claims.sub}:${peer.claims.session_id}`;
    const response = this.coordinator.register(
      peer.claims.session_id, credentialId, peer.socket, hello,
    );
    peer.e2eeCredentialId = credentialId;
    return response;
  }

  registerBot(
    peer: Peer,
    hello: E2eeBotHello,
    sendOp: (op: number, data: Record<string, unknown>) => void,
  ): void {
    if (!peer.claims.is_bot) throw new Error('Bot E2EE registration required');
    const credentialId = `${peer.claims.sub}:${peer.claims.session_id}`;
    this.botSenders.set(peer.claims.session_id, sendOp);
    try {
      this.coordinator.registerBot(peer.claims.session_id, credentialId, hello);
      peer.e2eeCredentialId = credentialId;
    } catch (error) {
      this.botSenders.delete(peer.claims.session_id);
      throw error;
    }
  }

  botEpochReady(sessionId: string, epoch: unknown): Promise<void> {
    return this.coordinator.botEpochReady(sessionId, epoch);
  }

  async handle(peer: Peer, request: RpcRequest): Promise<void> {
    switch (request.type) {
      case 'e2ee_epoch_ready':
        await this.coordinator.epochReady(peer.claims.session_id, request.epoch);
        return;
      case 'e2ee_commit_add':
        await this.coordinator.commitAdd(
          peer.claims.session_id, request.target_session_id, request.epoch,
          request.commit, request.welcome, request.ratchet_tree, request.bot_envelopes,
        );
        return;
      case 'e2ee_commit_remove':
        await this.coordinator.commitRemove(
          peer.claims.session_id, request.credential_id, request.epoch, request.commit,
          request.bot_envelopes,
        );
        return;
      case 'e2ee_commit_rotate':
        await this.coordinator.commitRotate(
          peer.claims.session_id, request.target_session_id, request.epoch,
          request.commit, request.bot_envelopes,
        );
        return;
      default:
        throw new Error('Unsupported E2EE request');
    }
  }

  unregister(sessionId: string): Promise<void> {
    return this.coordinator.unregister(sessionId);
  }

  async unregisterBot(sessionId: string): Promise<void> {
    this.botSenders.delete(sessionId);
    await this.coordinator.unregisterBot(sessionId);
  }

  close(): void {
    this.coordinator.close();
    this.botSenders.clear();
  }

  private async setTransitioning(transitioning: boolean): Promise<void> {
    this.transitioning = transitioning;
    const operations: Promise<void>[] = [];
    for (const peer of this.peers.values()) {
      for (const producer of peer.producers.values()) {
        if (transitioning) operations.push(producer.pause());
        else {
          const source = producer.appData.source as MediaSource;
          const keepPaused = (source === 'microphone' || source === 'screen-audio')
            && (peer.selfMuted || peer.serverMuted);
          if (!keepPaused) operations.push(producer.resume());
        }
      }
    }
    await Promise.all(operations);
  }
}
