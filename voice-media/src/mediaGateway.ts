import type { IncomingMessage } from 'node:http';

import type { Consumer, Producer, WebRtcTransport } from 'mediasoup/types';
import WebSocket, { WebSocketServer, type RawData } from 'ws';

import { metrics } from './metrics.js';
import type { Peer, Room } from './room.js';
import { rooms } from './roomRegistry.js';
import { ticketVerifier } from './ticketVerifier.js';
import type { MediaSource, RpcRequest } from './types.js';

const MAX_MESSAGE_BYTES = 64 * 1024;
export const MEDIA_RPC_METRIC_TYPES = [
  'identify',
  'create_transport',
  'connect_transport',
  'produce',
  'consume',
  'resume_consumer',
  'pause_consumer',
  'close_consumer',
  'pause_producer',
  'resume_producer',
  'set_speaking',
  'close_producer',
  'set_consumer_layers',
  'ping',
] as const;
type MediaRpcMetricType = typeof MEDIA_RPC_METRIC_TYPES[number] | 'unknown';
const mediaRpcMetricTypes = new Set<string>(MEDIA_RPC_METRIC_TYPES);

export function normalizeRpcMetricType(type: unknown): MediaRpcMetricType {
  return typeof type === 'string' && mediaRpcMetricTypes.has(type)
    ? type as MediaRpcMetricType
    : 'unknown';
}

function send(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function reply(socket: WebSocket, request: RpcRequest, data: Record<string, unknown> = {}): void {
  send(socket, { type: `${request.type}_ok`, request_id: request.request_id, ...data });
}

function fail(socket: WebSocket, request: RpcRequest, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Media request failed';
  send(socket, { type: 'error', request_id: request.request_id, code: 'media_request_failed', message });
}

function requireTransport(peer: Peer, id?: string): WebRtcTransport {
  const transport = id ? peer.transports.get(id) : undefined;
  if (!transport) throw new Error('Transport not found');
  return transport;
}

function requireProducer(room: Room, id?: string): Producer {
  const owner = id ? room.producerOwner(id) : undefined;
  const producer = id ? owner?.producers.get(id) : undefined;
  if (!producer) throw new Error('Producer not found');
  return producer;
}

function requireOwnProducer(peer: Peer, id?: string): Producer {
  const producer = id ? peer.producers.get(id) : undefined;
  if (!producer) throw new Error('Owned producer not found');
  return producer;
}

export async function applySpeakingHint(room: Room, peer: Peer, request: RpcRequest): Promise<void> {
  if (typeof request.speaking !== 'boolean') throw new Error('Speaking state is required');
  const producer = requireOwnProducer(peer, request.producer_id);
  if (producer.kind !== 'audio' || producer.appData.source !== 'microphone') {
    throw new Error('Owned microphone producer required');
  }
  await room.setExternalProducerSpeaking(producer.id, request.speaking);
}

export function requireCanProduceSource(peer: Peer, source: MediaSource): void {
  if ((source === 'microphone' || source === 'screen-audio') && peer.claims.can_speak !== true) {
    throw new Error('SPEAK permission required');
  }
  if ((source === 'screen-video' || source === 'screen-audio') && peer.claims.can_stream !== true) {
    throw new Error('STREAM permission required');
  }
}

export function requireSourceAvailable(peer: Peer, source: MediaSource): void {
  if (peer.sourceProducers.has(source)) throw new Error(`${source} producer already exists`);
}

export function requireConsumerAvailable(peer: Peer, producerId: string): void {
  if ([...peer.consumers.values()].some((consumer) => consumer.producerId === producerId)) {
    throw new Error('Producer is already consumed by this peer');
  }
}

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private readonly maxPending = 64) {}

  run(task: () => Promise<void>): Promise<void> {
    if (this.pending >= this.maxPending) {
      return Promise.reject(new Error('Media request queue limit exceeded'));
    }
    this.pending += 1;
    const result = this.tail.catch(() => undefined).then(task).finally(() => {
      this.pending -= 1;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

function requireConsumer(peer: Peer, id?: string): Consumer {
  const consumer = id ? peer.consumers.get(id) : undefined;
  if (!consumer) throw new Error('Consumer not found');
  return consumer;
}

export class MediaGateway {
  readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  constructor() {
    this.server.on('connection', (socket, request) => void this.handle(socket, request));
  }

  handleUpgrade(request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): boolean {
    const url = new URL(request.url ?? '/', 'http://voice-media.local');
    if (url.pathname !== '/ws/media') return false;
    this.server.handleUpgrade(request, socket, head, (websocket) => {
      this.server.emit('connection', websocket, request);
    });
    return true;
  }

  private async handle(socket: WebSocket, _request: IncomingMessage): Promise<void> {
    let peer: Peer | undefined;
    let room: Room | undefined;
    let socketClosed = false;
    const requests = new SerialTaskQueue();
    const identifyTimer = setTimeout(() => socket.close(4003, 'Identify required'), 10_000);

    const processMessage = async (raw: RawData): Promise<void> => {
      if (socketClosed) return;
      const started = process.hrtime.bigint();
      let request: RpcRequest = { type: 'unknown' };
      let metricType: MediaRpcMetricType = 'unknown';
      try {
        const parsed: unknown = JSON.parse(raw.toString());
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Media request must be an object');
        }
        request = parsed as RpcRequest;
        metricType = normalizeRpcMetricType(request.type);
        if (typeof request.type !== 'string' || !request.type) throw new Error('Message type is required');
        if (!peer) {
          if (request.type !== 'identify' || !request.ticket) throw new Error('Identify required');
          const claims = await ticketVerifier.verify(request.ticket);
          const lease = await rooms.acquire(Number(claims.channel_id), claims.room_epoch);
          room = lease.room;
          try {
            if (socketClosed) return;
            peer = room.addPeer(claims, socket);
          } finally {
            lease.release();
          }
          clearTimeout(identifyTimer);
          reply(socket, request, {
            protocol_version: 1,
            session_id: claims.session_id,
            router_rtp_capabilities: room.router.rtpCapabilities,
            producers: room.descriptors(claims.session_id),
          });
          room.broadcast('peer_joined', {
            user_id: Number(claims.sub),
            username: claims.username,
            display_name: claims.display_name,
            avatar_url: claims.avatar_url,
            session_id: claims.session_id,
          }, claims.session_id);
          return;
        }
        if (!room) throw new Error('Room unavailable');
        if (!room.isCurrentPeer(peer)) throw new Error('Media session was replaced');
        await this.dispatch(socket, room, peer, request);
      } catch (error) {
        fail(socket, request, error);
        if (!peer) socket.close(4004, 'Authentication failed');
      } finally {
        const duration = Number(process.hrtime.bigint() - started) / 1_000_000_000;
        metrics.rpcDuration.observe({ type: metricType }, duration);
      }
    };

    socket.on('message', (raw) => {
      void requests.run(() => processMessage(raw)).catch(() => {
        if (!socketClosed) socket.close(4008, 'Media request queue limit exceeded');
      });
    });

    socket.on('close', (code) => {
      socketClosed = true;
      clearTimeout(identifyTimer);
      metrics.mediaSocketCloses.inc({ code: String(code) });
      if (peer && room) room.removePeer(peer.claims.session_id, peer);
    });
    socket.on('error', () => socket.close());
  }

  private async dispatch(socket: WebSocket, room: Room, peer: Peer, request: RpcRequest): Promise<void> {
    switch (request.type) {
      case 'create_transport': {
        if (request.direction !== 'send' && request.direction !== 'recv') throw new Error('Invalid direction');
        const transport = await room.createWebRtcTransport(peer, request.direction);
        reply(socket, request, {
          transport_id: transport.id,
          ice_parameters: transport.iceParameters,
          ice_candidates: transport.iceCandidates,
          dtls_parameters: transport.dtlsParameters,
          sctp_parameters: transport.sctpParameters,
        });
        return;
      }
      case 'connect_transport': {
        if (!request.dtls_parameters) throw new Error('DTLS parameters are required');
        await requireTransport(peer, request.transport_id).connect({ dtlsParameters: request.dtls_parameters });
        reply(socket, request);
        return;
      }
      case 'produce': {
        if (!request.kind || !request.rtp_parameters || !request.source) throw new Error('Producer data is incomplete');
        const source = request.source as MediaSource;
        if (!['microphone', 'screen-video', 'screen-audio'].includes(source)) throw new Error('Invalid media source');
        if ((source === 'microphone' || source === 'screen-audio') && request.kind !== 'audio') throw new Error('Audio source required');
        if (source === 'screen-video' && request.kind !== 'video') throw new Error('Video source required');
        requireCanProduceSource(peer, source);
        requireSourceAvailable(peer, source);
        const transport = requireTransport(peer, request.transport_id);
        if (transport.appData.direction !== 'send') throw new Error('Send transport required');
        const producer = await transport.produce({
          kind: request.kind,
          rtpParameters: request.rtp_parameters,
          appData: { source, userId: Number(peer.claims.sub), sessionId: peer.claims.session_id },
        });
        await room.addProducer(peer, transport, producer, source);
        reply(socket, request, { producer_id: producer.id });
        return;
      }
      case 'consume': {
        if (!request.rtp_capabilities || !request.producer_id) throw new Error('Consumer data is incomplete');
        requireConsumerAvailable(peer, request.producer_id);
        const producer = requireProducer(room, request.producer_id);
        if (!room.router.canConsume({ producerId: producer.id, rtpCapabilities: request.rtp_capabilities })) {
          throw new Error('Producer cannot be consumed');
        }
        const transport = requireTransport(peer, request.transport_id);
        if (transport.appData.direction !== 'recv') throw new Error('Receive transport required');
        const consumer = await transport.consume({
          producerId: producer.id,
          rtpCapabilities: request.rtp_capabilities,
          paused: true,
          appData: { source: producer.appData.source, userId: producer.appData.userId },
        });
        room.addConsumer(peer, consumer);
        reply(socket, request, {
          consumer_id: consumer.id,
          producer_id: producer.id,
          kind: consumer.kind,
          rtp_parameters: consumer.rtpParameters,
          source: producer.appData.source,
          user_id: producer.appData.userId,
          producer_paused: consumer.producerPaused,
        });
        return;
      }
      case 'resume_consumer':
        await room.setConsumerUserPaused(requireConsumer(peer, request.consumer_id), false);
        reply(socket, request);
        return;
      case 'pause_consumer':
        await room.setConsumerUserPaused(requireConsumer(peer, request.consumer_id), true);
        reply(socket, request);
        return;
      case 'close_consumer':
        requireConsumer(peer, request.consumer_id).close();
        reply(socket, request);
        return;
      case 'pause_producer':
        await room.setProducerSelfMuted(peer, requireOwnProducer(peer, request.producer_id), true);
        reply(socket, request);
        return;
      case 'resume_producer':
        await room.setProducerSelfMuted(peer, requireOwnProducer(peer, request.producer_id), false);
        reply(socket, request);
        return;
      case 'set_speaking':
        await applySpeakingHint(room, peer, request);
        reply(socket, request);
        return;
      case 'close_producer':
        requireOwnProducer(peer, request.producer_id).close();
        reply(socket, request);
        return;
      case 'set_consumer_layers':
        await requireConsumer(peer, request.consumer_id).setPreferredLayers({
          spatialLayer: request.spatial_layer ?? 0,
          temporalLayer: request.temporal_layer,
        });
        reply(socket, request);
        return;
      case 'ping':
        reply(socket, request, { now: Date.now() });
        return;
      default:
        throw new Error(`Unsupported media request: ${request.type}`);
    }
  }
}

export const mediaGateway = new MediaGateway();
