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

import { ActivityRefreshQueue } from './activityRefreshQueue.js';
import { config } from './config.js';
import { ConsumerPauseCoordinator } from './consumerPauseCoordinator.js';
import { DirectTransportRegistry } from './directTransportRegistry.js';
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

export const ACTIVE_SPEAKER_HANGOVER_MS = 1_800;
export const AUDIO_LEVEL_OBSERVER_INTERVAL_MS = 250;
export const EXTERNAL_SPEAKING_HINT_TTL_MS = 750;
export const EXTERNAL_SPEAKING_HINT_BACKOFF_MS = 3_000;
export const ACTIVITY_TRANSITION_RETRY_MS = 100;

export class Room extends EventEmitter {
  readonly channelId: number;
  readonly epoch: string;
  readonly router: Router;
  readonly webRtcServer: WebRtcServer;
  readonly workerPid: number;
  readonly peers = new Map<string, Peer>();
  readonly directTransports: Map<string, DirectTransport>;
  private readonly directTransportRegistry: DirectTransportRegistry;
  private readonly audioObserver: AudioLevelObserver;
  private readonly consumerPauses = new ConsumerPauseCoordinator();
  private observedMicrophones = new Set<string>();
  private externalMicrophones = new Map<string, number>();
  private externalHintCooldownUntil = new Map<string, number>();
  private externalHintTimer?: ReturnType<typeof setTimeout>;
  private activityRetryTimer?: ReturnType<typeof setTimeout>;
  private readonly activityRefresh = new ActivityRefreshQueue(
    (emit, priority) => this.refreshActiveMicrophones(emit, priority),
  );
  private activeMicrophones = new Set<string>();
  private selectedMicrophones = new Set<string>();
  private microphoneLastActiveAt = new Map<string, number>();
  private microphoneGateEnabled = false;
  private closed = false;
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
    this.directTransportRegistry = new DirectTransportRegistry(
      router,
      (peer) => !this.closed && this.isCurrentPeer(peer),
    );
    this.directTransports = this.directTransportRegistry.transports;
    audioObserver.on('volumes', (volumes) => {
      this.observedMicrophones = new Set(volumes.map(({ producer }) => producer.id));
      const now = Date.now();
      for (const producerId of this.observedMicrophones) {
        this.microphoneLastActiveAt.set(producerId, now);
        // The server observer is authoritative once RTP audio is visible.
        this.externalMicrophones.delete(producerId);
      }
      this.dropExpiredExternalHints(now);
      this.scheduleExternalHintExpiry(now);
      this.requestActivityRefresh();
    });
    audioObserver.on('silence', () => {
      this.observedMicrophones.clear();
      this.externalMicrophones.clear();
      this.clearExternalHintTimer();
      this.requestActivityRefresh();
    });
    metrics.rooms.inc();
  }

  static async create(channelId: number, epoch: string): Promise<Room> {
    const { router, webRtcServer, workerPid } = await workerPool.createRouter();
    try {
      const observer = await router.createAudioLevelObserver({
        maxEntries: config.maxActiveSpeakers,
        threshold: -80,
        interval: AUDIO_LEVEL_OBSERVER_INTERVAL_MS,
      });
      return new Room(channelId, epoch, router, webRtcServer, workerPid, observer);
    } catch (error) {
      router.close();
      throw error;
    }
  }

  onEmpty(callback: () => void): void {
    this.onEmptyCallback = callback;
  }

  addPeer(claims: MediaClaims, socket: WebSocket): Peer {
    const old = this.peers.get(claims.session_id);
    if (old) {
      this.removePeer(claims.session_id, old, true);
      try { old.socket.close(4000, 'Media session replaced'); } catch { /* already closed */ }
    }
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

  isCurrentPeer(peer: Peer): boolean {
    return this.peers.get(peer.claims.session_id) === peer;
  }

  isEmpty(): boolean {
    return this.peers.size === 0 && this.directTransports.size === 0;
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
    if (!this.isCurrentPeer(peer)) throw new Error('Media session was replaced');
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
    if (!this.isCurrentPeer(peer)) {
      transport.close();
      throw new Error('Media session was replaced');
    }
    try {
      if (direction === 'send') await transport.setMaxIncomingBitrate(config.maxIncomingBitrate);
    } catch (error) {
      transport.close();
      throw error;
    }
    if (!this.isCurrentPeer(peer)) {
      transport.close();
      throw new Error('Media session was replaced');
    }
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
    if (!this.isCurrentPeer(peer)) {
      producer.close();
      throw new Error('Media session was replaced');
    }
    if (peer.sourceProducers.has(source)) {
      producer.close();
      throw new Error(`${source} producer already exists`);
    }
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
    metrics.producers.inc();
    try {
      if (source === 'microphone') {
        await this.audioObserver.addProducer({ producerId: producer.id });
        await this.activityRefresh.request(false);
      }
      if (
        !this.isCurrentPeer(peer)
        || producer.closed
        || peer.producers.get(producer.id) !== producer
        || peer.sourceProducers.get(source) !== producer.id
      ) {
        throw new Error('Media session was replaced');
      }
    } catch (error) {
      producer.close();
      throw error;
    }
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
    this.externalHintCooldownUntil.delete(producer.id);
    this.activeMicrophones.delete(producer.id);
    this.selectedMicrophones.delete(producer.id);
    this.microphoneLastActiveAt.delete(producer.id);
    metrics.producers.dec();
    this.broadcast('producer_closed', {
      producer_id: producer.id,
      user_id: Number(peer.claims.sub),
      source,
    });
    this.emit('producerClosed', producer.id, peer);
    if (source === 'microphone') this.requestActivityRefresh(false);
  }

  addConsumer(peer: Peer, consumer: Consumer): void {
    if (!this.isCurrentPeer(peer)) {
      consumer.close();
      throw new Error('Media session was replaced');
    }
    const owner = this.producerOwner(consumer.producerId);
    const producer = owner?.producers.get(consumer.producerId);
    if (consumer.closed || !producer || producer.closed) {
      consumer.close();
      throw new Error('Producer is no longer available');
    }
    consumer.appData.userPaused = false;
    consumer.appData.activityPaused = false;
    this.consumerPauses.register(consumer);
    const source = producer.appData.source;
    const activityPaused = source === 'microphone'
      && this.microphoneGateEnabled
      && !this.selectedMicrophones.has(consumer.producerId);
    peer.consumers.set(consumer.id, consumer);
    workerPool.adjustConsumers(this.workerPid, 1);
    metrics.consumers.inc();
    const cleanup = () => {
      if (!peer.consumers.delete(consumer.id)) return;
      this.consumerPauses.unregister(consumer);
      workerPool.adjustConsumers(this.workerPid, -1);
      metrics.consumers.dec();
    };
    consumer.on('transportclose', cleanup);
    consumer.on('producerclose', () => {
      notify(peer.socket, 'producer_closed', { producer_id: consumer.producerId });
      cleanup();
    });
    consumer.on('@close', cleanup);
    if (activityPaused) {
      void this.setConsumerActivityPaused(consumer, true).catch(() => this.scheduleActivityRetry());
    }
  }

  async setConsumerUserPaused(consumer: Consumer, paused: boolean): Promise<void> {
    await this.consumerPauses.setUserPaused(consumer, paused);
  }

  async setExternalProducerSpeaking(producerId: string, speaking: boolean): Promise<void> {
    const owner = this.producerOwner(producerId);
    if (owner?.producers.get(producerId)?.appData.source !== 'microphone') return;
    const now = Date.now();
    if (speaking) {
      if ((this.externalHintCooldownUntil.get(producerId) ?? 0) > now) return;
      this.externalMicrophones.set(producerId, now + EXTERNAL_SPEAKING_HINT_TTL_MS);
      this.externalHintCooldownUntil.set(producerId, now + EXTERNAL_SPEAKING_HINT_BACKOFF_MS);
      this.microphoneLastActiveAt.set(producerId, now);
      this.scheduleExternalHintExpiry(now);
    } else {
      // A client can emit duplicate speech-end hints. If the hint is already
      // absent there is no room state to reconcile; returning here prevents an
      // authenticated peer from forcing an O(peers * consumers) refresh loop.
      if (!this.externalMicrophones.delete(producerId)) return;
      this.scheduleExternalHintExpiry(now);
    }
    await this.activityRefresh.request(true, speaking ? producerId : undefined);
  }

  async createDirectTransport(peer: Peer): Promise<DirectTransport> {
    return this.directTransportRegistry.getOrCreate(peer);
  }

  removePeer(sessionId: string, expectedPeer?: Peer, suppressEmpty = false): void {
    const peer = this.peers.get(sessionId);
    if (!peer || (expectedPeer && peer !== expectedPeer)) return;
    for (const consumer of peer.consumers.values()) consumer.close();
    for (const producer of peer.producers.values()) producer.close();
    for (const transport of peer.transports.values()) transport.close();
    this.directTransportRegistry.remove(sessionId, expectedPeer);
    this.peers.delete(sessionId);
    metrics.peers.dec();
    this.broadcast('peer_closed', { user_id: Number(peer.claims.sub), session_id: sessionId });
    if (!suppressEmpty && this.peers.size === 0 && this.directTransports.size === 0) {
      this.onEmptyCallback?.();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearExternalHintTimer();
    if (this.activityRetryTimer) clearTimeout(this.activityRetryTimer);
    this.activityRetryTimer = undefined;
    this.activityRefresh.close();
    for (const sessionId of [...this.peers.keys()]) this.removePeer(sessionId);
    this.directTransportRegistry.close();
    this.audioObserver.close();
    this.router.close();
    metrics.rooms.dec();
  }

  private async refreshActiveMicrophones(
    emitActiveSpeakers = true,
    priorityProducerId?: string,
  ): Promise<void> {
    if (this.closed) return;
    const microphoneIds = this.microphoneProducerIds();
    const microphoneIdSet = new Set(microphoneIds);
    const active = [...new Set([
      ...(priorityProducerId ? [priorityProducerId] : []),
      ...this.externalMicrophones.keys(),
      ...this.observedMicrophones,
    ])]
      .filter((producerId) => microphoneIdSet.has(producerId))
      .slice(0, config.maxActiveSpeakers);
    this.activeMicrophones = new Set(active);
    const users = [...this.activeMicrophones].map((producerId) => {
      const peer = this.producerOwner(producerId);
      return peer ? Number(peer.claims.sub) : null;
    }).filter((value): value is number => value !== null);
    if (emitActiveSpeakers) this.broadcast('active_speakers', { user_ids: users });

    if (microphoneIds.length <= config.maxActiveSpeakers) {
      this.microphoneGateEnabled = false;
      this.selectedMicrophones = microphoneIdSet;
    } else {
      this.selectMicrophonesForLargeRoom(microphoneIds, active, priorityProducerId);
    }

    for (const peer of this.peers.values()) {
      for (const consumer of peer.consumers.values()) {
        const owner = this.producerOwner(consumer.producerId);
        const source = owner?.producers.get(consumer.producerId)?.appData.source;
        if (source !== 'microphone') continue;
        const shouldPause = this.microphoneGateEnabled
          && !this.selectedMicrophones.has(consumer.producerId);
        try {
          await this.setConsumerActivityPaused(consumer, shouldPause);
        } catch {
          this.scheduleActivityRetry();
        }
      }
    }
  }

  private microphoneProducerIds(): string[] {
    const ids: string[] = [];
    for (const peer of this.peers.values()) {
      for (const producer of peer.producers.values()) {
        if (producer.appData.source === 'microphone') ids.push(producer.id);
      }
    }
    return ids;
  }

  private selectMicrophonesForLargeRoom(
    microphoneIds: string[],
    activeIds: string[],
    priorityProducerId?: string,
  ): void {
    const now = Date.now();
    if (!this.microphoneGateEnabled) {
      for (const producerId of this.selectedMicrophones) {
        if (!this.microphoneLastActiveAt.has(producerId)) this.microphoneLastActiveAt.set(producerId, now);
      }
    }
    this.microphoneGateEnabled = true;
    const activeSet = new Set(activeIds);
    const next = new Set<string>();
    const append = (producerId: string) => {
      if (next.size < config.maxActiveSpeakers && microphoneIds.includes(producerId)) next.add(producerId);
    };

    if (priorityProducerId && activeSet.has(priorityProducerId)) append(priorityProducerId);
    for (const producerId of this.selectedMicrophones) {
      if (activeSet.has(producerId)) append(producerId);
    }
    for (const producerId of activeIds) append(producerId);
    for (const producerId of this.selectedMicrophones) {
      const lastActiveAt = this.microphoneLastActiveAt.get(producerId);
      if (lastActiveAt !== undefined && now - lastActiveAt < ACTIVE_SPEAKER_HANGOVER_MS) append(producerId);
    }
    // Keep up to four routes warm through silence. A new VAD/observer event replaces
    // one retained route immediately instead of losing its first syllable.
    for (const producerId of this.selectedMicrophones) append(producerId);
    for (const producerId of microphoneIds) append(producerId);
    this.selectedMicrophones = next;
  }

  private dropExpiredExternalHints(now: number): void {
    for (const [producerId, expiresAt] of this.externalMicrophones) {
      if (expiresAt <= now) this.externalMicrophones.delete(producerId);
    }
    for (const [producerId, cooldownUntil] of this.externalHintCooldownUntil) {
      if (cooldownUntil <= now) this.externalHintCooldownUntil.delete(producerId);
    }
  }

  private scheduleExternalHintExpiry(now = Date.now()): void {
    this.clearExternalHintTimer();
    const nextExpiry = Math.min(...this.externalMicrophones.values());
    if (!Number.isFinite(nextExpiry)) return;
    this.externalHintTimer = setTimeout(() => {
      this.externalHintTimer = undefined;
      const current = Date.now();
      this.dropExpiredExternalHints(current);
      this.scheduleExternalHintExpiry(current);
      this.requestActivityRefresh(false);
    }, Math.max(1, nextExpiry - now));
    this.externalHintTimer.unref?.();
  }

  private clearExternalHintTimer(): void {
    if (this.externalHintTimer) clearTimeout(this.externalHintTimer);
    this.externalHintTimer = undefined;
  }

  private async setConsumerActivityPaused(consumer: Consumer, paused: boolean): Promise<void> {
    await this.consumerPauses.setActivityPaused(consumer, paused);
  }

  private requestActivityRefresh(emit = true, priorityProducerId?: string): void {
    void this.activityRefresh.request(emit, priorityProducerId)
      .catch(() => this.scheduleActivityRetry());
  }

  private scheduleActivityRetry(): void {
    if (this.closed || this.activityRetryTimer) return;
    this.activityRetryTimer = setTimeout(() => {
      this.activityRetryTimer = undefined;
      this.requestActivityRefresh(false);
    }, ACTIVITY_TRANSITION_RETRY_MS);
    this.activityRetryTimer.unref?.();
  }
}
