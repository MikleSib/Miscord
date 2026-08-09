import { EventEmitter } from 'node:events';

import type {
  AudioLevelObserver,
  Consumer,
  DirectTransport,
  Producer,
  Router,
  Transport,
  WebRtcServer,
  WebRtcTransport,
} from 'mediasoup/types';
import type WebSocket from 'ws';

import { config } from './config.js';
import { metrics } from './metrics.js';
import type { MediaClaims, MediaSource, ProducerDescriptor } from './types.js';
import { workerPool } from './workerPool.js';

export interface Peer {
  claims: MediaClaims;
  socket: WebSocket;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
  sourceProducers: Map<MediaSource, string>;
}

function notify(socket: WebSocket, type: string, data: Record<string, unknown>): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type, ...data }));
}

export class Room extends EventEmitter {
  readonly channelId: number;
  readonly epoch: string;
  readonly router: Router;
  readonly webRtcServer: WebRtcServer;
  readonly workerPid: number;
  readonly peers = new Map<string, Peer>();
  readonly directTransports = new Map<string, DirectTransport>();
  private readonly audioObserver: AudioLevelObserver;
  private observedMicrophones = new Set<string>();
  private externalMicrophones = new Set<string>();
  private activeMicrophones = new Set<string>();
  private onEmptyCallback?: () => void;

  private constructor(
    channelId: number,
    epoch: string,
    router: Router,
    webRtcServer: WebRtcServer,
    workerPid: number,
    audioObserver: AudioLevelObserver,
  ) {
    super();
    this.channelId = channelId;
    this.epoch = epoch;
    this.router = router;
    this.webRtcServer = webRtcServer;
    this.workerPid = workerPid;
    this.audioObserver = audioObserver;
    audioObserver.on('volumes', (volumes) => {
      this.observedMicrophones = new Set(volumes.map(({ producer }) => producer.id));
      void this.refreshActiveMicrophones();
    });
    audioObserver.on('silence', () => {
      this.observedMicrophones.clear();
      void this.refreshActiveMicrophones();
    });
    metrics.rooms.inc();
  }

  static async create(channelId: number, epoch: string): Promise<Room> {
    const { router, webRtcServer, workerPid } = await workerPool.createRouter();
    const observer = await router.createAudioLevelObserver({
      maxEntries: config.maxActiveSpeakers,
      threshold: -80,
      interval: 400,
    });
    return new Room(channelId, epoch, router, webRtcServer, workerPid, observer);
  }

  onEmpty(callback: () => void): void {
    this.onEmptyCallback = callback;
  }

  addPeer(claims: MediaClaims, socket: WebSocket): Peer {
    const old = this.peers.get(claims.session_id);
    if (old) this.removePeer(claims.session_id);
    const peer: Peer = {
      claims,
      socket,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      sourceProducers: new Map(),
    };
    this.peers.set(claims.session_id, peer);
    metrics.peers.inc();
    return peer;
  }

  descriptors(excludeSessionId?: string): ProducerDescriptor[] {
    const result: ProducerDescriptor[] = [];
    for (const [sessionId, peer] of this.peers) {
      if (sessionId === excludeSessionId) continue;
      for (const producer of peer.producers.values()) {
        result.push({
          producer_id: producer.id,
          user_id: Number(peer.claims.sub),
          source: producer.appData.source as MediaSource,
          kind: producer.kind,
        });
      }
    }
    return result;
  }

  producerOwner(producerId: string): Peer | undefined {
    for (const peer of this.peers.values()) {
      if (peer.producers.has(producerId)) return peer;
    }
    return undefined;
  }

  broadcast(type: string, data: Record<string, unknown>, excludeSessionId?: string): void {
    for (const [sessionId, peer] of this.peers) {
      if (sessionId !== excludeSessionId && !peer.claims.is_bot) notify(peer.socket, type, data);
    }
  }

  async createWebRtcTransport(peer: Peer, direction: 'send' | 'recv'): Promise<WebRtcTransport> {
    if ([...peer.transports.values()].some((item) => item.appData.direction === direction)) {
      throw new Error(`${direction} transport already exists`);
    }
    const transport = await this.router.createWebRtcTransport({
      webRtcServer: this.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: config.initialOutgoingBitrate,
      appData: { sessionId: peer.claims.session_id, direction },
    });
    if (direction === 'send') await transport.setMaxIncomingBitrate(config.maxIncomingBitrate);
    transport.on('icestatechange', (state) => {
      metrics.transportStateTransitions.inc({ kind: 'ice', state });
    });
    transport.on('dtlsstatechange', (state) => {
      metrics.transportStateTransitions.inc({ kind: 'dtls', state });
      if (state === 'closed' || state === 'failed') transport.close();
    });
    transport.on('routerclose', () => peer.transports.delete(transport.id));
    transport.on('@close', () => {
      if (peer.transports.delete(transport.id)) metrics.transports.dec();
    });
    peer.transports.set(transport.id, transport);
    metrics.transports.inc();
    return transport;
  }

  async addProducer(peer: Peer, transport: Transport, producer: Producer, source: MediaSource): Promise<void> {
    if (peer.sourceProducers.has(source)) throw new Error(`${source} producer already exists`);
    if (source.startsWith('screen-')) {
      const screenPeers = new Set(
        [...this.peers.values()].filter((candidate) =>
          candidate.sourceProducers.has('screen-video'),
        ).map((candidate) => candidate.claims.session_id),
      );
      if (!screenPeers.has(peer.claims.session_id) && screenPeers.size >= config.maxScreenShares) {
        producer.close();
        throw new Error('Screen share capacity reached');
      }
    }
    peer.producers.set(producer.id, producer);
    peer.sourceProducers.set(source, producer.id);
    producer.on('transportclose', () => this.removeProducer(peer, producer, source));
    producer.on('@close', () => this.removeProducer(peer, producer, source));
    if (source === 'microphone') await this.audioObserver.addProducer({ producerId: producer.id });
    metrics.producers.inc();
    this.broadcast('producer_available', {
      producer_id: producer.id,
      user_id: Number(peer.claims.sub),
      kind: producer.kind,
      source,
    }, peer.claims.session_id);
    this.emit('producerAvailable', producer, peer);
  }

  private removeProducer(peer: Peer, producer: Producer, source: MediaSource): void {
    if (!peer.producers.delete(producer.id)) return;
    if (peer.sourceProducers.get(source) === producer.id) peer.sourceProducers.delete(source);
    this.observedMicrophones.delete(producer.id);
    this.externalMicrophones.delete(producer.id);
    this.activeMicrophones.delete(producer.id);
    metrics.producers.dec();
    this.broadcast('producer_closed', {
      producer_id: producer.id,
      user_id: Number(peer.claims.sub),
      source,
    });
    this.emit('producerClosed', producer.id, peer);
  }

  addConsumer(peer: Peer, consumer: Consumer): void {
    consumer.appData.userPaused = false;
    consumer.appData.activityPaused = false;
    peer.consumers.set(consumer.id, consumer);
    workerPool.adjustConsumers(this.workerPid, 1);
    metrics.consumers.inc();
    const cleanup = () => {
      if (!peer.consumers.delete(consumer.id)) return;
      workerPool.adjustConsumers(this.workerPid, -1);
      metrics.consumers.dec();
    };
    consumer.on('transportclose', cleanup);
    consumer.on('producerclose', () => {
      notify(peer.socket, 'producer_closed', { producer_id: consumer.producerId });
      cleanup();
    });
    consumer.on('@close', cleanup);
  }

  async setConsumerUserPaused(consumer: Consumer, paused: boolean): Promise<void> {
    consumer.appData.userPaused = paused;
    await this.applyConsumerPauseState(consumer);
  }

  async setExternalProducerSpeaking(producerId: string, speaking: boolean): Promise<void> {
    if (!this.producerOwner(producerId)) return;
    if (speaking) this.externalMicrophones.add(producerId);
    else this.externalMicrophones.delete(producerId);
    await this.refreshActiveMicrophones();
  }

  async createDirectTransport(sessionId: string): Promise<DirectTransport> {
    const current = this.directTransports.get(sessionId);
    if (current && !current.closed) return current;
    const transport = await this.router.createDirectTransport({ appData: { sessionId } });
    transport.on('@close', () => this.directTransports.delete(sessionId));
    this.directTransports.set(sessionId, transport);
    return transport;
  }

  removePeer(sessionId: string): void {
    const peer = this.peers.get(sessionId);
    if (!peer) return;
    for (const consumer of peer.consumers.values()) consumer.close();
    for (const producer of peer.producers.values()) producer.close();
    for (const transport of peer.transports.values()) transport.close();
    this.directTransports.get(sessionId)?.close();
    this.directTransports.delete(sessionId);
    this.peers.delete(sessionId);
    metrics.peers.dec();
    this.broadcast('peer_closed', { user_id: Number(peer.claims.sub), session_id: sessionId });
    if (this.peers.size === 0 && this.directTransports.size === 0) this.onEmptyCallback?.();
  }

  close(): void {
    for (const sessionId of [...this.peers.keys()]) this.removePeer(sessionId);
    for (const transport of this.directTransports.values()) transport.close();
    this.audioObserver.close();
    this.router.close();
    metrics.rooms.dec();
  }

  private async refreshActiveMicrophones(): Promise<void> {
    const active = new Set(
      [...this.externalMicrophones, ...this.observedMicrophones].slice(0, config.maxActiveSpeakers),
    );
    this.activeMicrophones = active;
    const users = [...this.activeMicrophones].map((producerId) => {
      const peer = this.producerOwner(producerId);
      return peer ? Number(peer.claims.sub) : null;
    }).filter((value): value is number => value !== null);
    this.broadcast('active_speakers', { user_ids: users });
    for (const peer of this.peers.values()) {
      for (const consumer of peer.consumers.values()) {
        const owner = this.producerOwner(consumer.producerId);
        const source = owner?.producers.get(consumer.producerId)?.appData.source;
        if (source !== 'microphone') continue;
        consumer.appData.activityPaused = !this.activeMicrophones.has(consumer.producerId);
        await this.applyConsumerPauseState(consumer);
      }
    }
  }

  private async applyConsumerPauseState(consumer: Consumer): Promise<void> {
    const paused = Boolean(consumer.appData.userPaused) || Boolean(consumer.appData.activityPaused);
    if (paused) await consumer.pause().catch(() => undefined);
    else await consumer.resume().catch(() => undefined);
  }
}

export class RoomRegistry {
  private readonly rooms = new Map<number, Room>();
  private readonly pendingRooms = new Map<number, Promise<Room>>();

  async getOrCreate(channelId: number, epoch: string): Promise<Room> {
    const existing = this.rooms.get(channelId);
    if (existing) {
      if (existing.epoch !== epoch) throw new Error('Room epoch mismatch');
      return existing;
    }

    const pending = this.pendingRooms.get(channelId);
    if (pending) {
      const room = await pending;
      if (room.epoch !== epoch) throw new Error('Room epoch mismatch');
      return room;
    }

    const creation = Room.create(channelId, epoch);
    this.pendingRooms.set(channelId, creation);
    let room: Room;
    try {
      room = await creation;
      room.onEmpty(() => {
        room.close();
        if (this.rooms.get(channelId) === room) this.rooms.delete(channelId);
      });
      this.rooms.set(channelId, room);
    } finally {
      if (this.pendingRooms.get(channelId) === creation) this.pendingRooms.delete(channelId);
    }
    return room;
  }

  get(channelId: number): Room | undefined {
    return this.rooms.get(channelId);
  }

  size(): number {
    return this.rooms.size;
  }

  close(): void {
    for (const room of this.rooms.values()) room.close();
    this.rooms.clear();
    this.pendingRooms.clear();
  }
}

export const rooms = new RoomRegistry();
