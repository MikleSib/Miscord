import type { DirectTransport, Router } from 'mediasoup/types';

import type { Peer } from './room.js';

interface PendingTransport {
  peer: Peer;
  promise: Promise<DirectTransport>;
}

export class DirectTransportRegistry {
  readonly transports = new Map<string, DirectTransport>();
  private readonly pending = new Map<string, PendingTransport>();

  constructor(
    private readonly router: Router,
    private readonly isPeerValid: (peer: Peer) => boolean,
  ) {}

  async getOrCreate(peer: Peer): Promise<DirectTransport> {
    if (!this.isPeerValid(peer)) throw new Error('Media session was replaced');
    const sessionId = peer.claims.session_id;
    const current = this.transports.get(sessionId);
    if (current && !current.closed) return current;
    const pending = this.pending.get(sessionId);
    if (pending?.peer === peer) return pending.promise;

    const promise = this.create(peer, sessionId);
    const creation: PendingTransport = { peer, promise };
    this.pending.set(sessionId, creation);
    try {
      return await promise;
    } finally {
      if (this.pending.get(sessionId) === creation) this.pending.delete(sessionId);
    }
  }

  remove(sessionId: string, expectedPeer?: Peer): void {
    const pending = this.pending.get(sessionId);
    if (!expectedPeer || pending?.peer === expectedPeer) this.pending.delete(sessionId);
    this.transports.get(sessionId)?.close();
    this.transports.delete(sessionId);
  }

  close(): void {
    this.pending.clear();
    for (const transport of this.transports.values()) transport.close();
    this.transports.clear();
  }

  private async create(peer: Peer, sessionId: string): Promise<DirectTransport> {
    const transport = await this.router.createDirectTransport({ appData: { sessionId } });
    try {
      if (!this.isPeerValid(peer) || transport.closed) {
        throw new Error('Media session was replaced');
      }
      transport.on('@close', () => {
        if (this.transports.get(sessionId) === transport) this.transports.delete(sessionId);
      });
      this.transports.set(sessionId, transport);
      return transport;
    } catch (error) {
      transport.close();
      throw error;
    }
  }
}
