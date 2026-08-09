import type { IncomingMessage } from 'node:http';

import type { Consumer, Producer, WebRtcTransport } from 'mediasoup/types';
import WebSocket, { WebSocketServer } from 'ws';

import { metrics } from './metrics.js';
import type { Peer, Room } from './room.js';
import { rooms } from './room.js';
import { ticketVerifier } from './ticketVerifier.js';
import type { MediaSource, RpcRequest } from './types.js';

const MAX_MESSAGE_BYTES = 64 * 1024;

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
    const identifyTimer = setTimeout(() => socket.close(4003, 'Identify required'), 10_000);

    socket.on('message', async (raw) => {
      const started = process.hrtime.bigint();
      let request: RpcRequest = { type: 'unknown' };
      try {
        request = JSON.parse(raw.toString()) as RpcRequest;
        if (!request.type) throw new Error('Message type is required');
        if (!peer) {
          if (request.type !== 'identify' || !request.ticket) throw new Error('Identify required');
          const claims = await ticketVerifier.verify(request.ticket);
          room = await rooms.getOrCreate(Number(claims.channel_id), claims.room_epoch);
          peer = room.addPeer(claims, socket);
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
        await this.dispatch(socket, room, peer, request);
      } catch (error) {
        fail(socket, request, error);
        if (!peer) socket.close(4004, 'Authentication failed');
      } finally {
        const duration = Number(process.hrtime.bigint() - started) / 1_000_000_000;
        metrics.rpcDuration.observe({ type: request.type }, duration);
      }
    });

    socket.on('close', (code) => {
      clearTimeout(identifyTimer);
      metrics.mediaSocketCloses.inc({ code: String(code) });
      if (peer && room) room.removePeer(peer.claims.session_id);
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
        await requireConsumer(peer, request.consumer_id).resume();
        reply(socket, request);
        return;
      case 'pause_consumer':
        await requireConsumer(peer, request.consumer_id).pause();
        reply(socket, request);
        return;
      case 'close_consumer':
        requireConsumer(peer, request.consumer_id).close();
        reply(socket, request);
        return;
      case 'pause_producer':
        await requireOwnProducer(peer, request.producer_id).pause();
        reply(socket, request);
        return;
      case 'resume_producer':
        await requireOwnProducer(peer, request.producer_id).resume();
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
