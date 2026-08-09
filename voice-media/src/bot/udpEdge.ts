import dgram from 'node:dgram';
import { randomBytes, randomInt } from 'node:crypto';

import type { Consumer, DirectTransport, Producer } from 'mediasoup/types';
import type WebSocket from 'ws';

import { config } from '../config.js';
import { metrics } from '../metrics.js';
import type { Peer, Room } from '../room.js';
import type { MediaClaims } from '../types.js';
import { AES_GCM_MODE, RtpCipher, supportedModes, XCHACHA_MODE, type EncryptionMode } from './crypto.js';
import { discoveryResponse, discoverySsrc, isDiscoveryPacket, OPUS_PAYLOAD_TYPE, parseRtpHeader, rewriteSsrc } from './rtp.js';

export interface RemoteTuple {
  address: string;
  port: number;
}

export interface VoiceSender {
  sendOp(op: number, data: Record<string, unknown>): void;
}

function randomSsrc(): number {
  return randomInt(1, 0xffff_ffff) >>> 0;
}

export class BotMediaSession {
  readonly ssrc = randomSsrc();
  readonly secretKey = randomBytes(32);
  readonly outboundSsrc = new Map<string, number>();
  remote?: RemoteTuple;
  cipher?: RtpCipher;
  mode: EncryptionMode = XCHACHA_MODE;
  peer!: Peer;
  directTransport!: DirectTransport;
  producer!: Producer;
  private readonly consumers = new Map<string, Consumer>();
  private readonly outboundUserIds = new Map<string, string>();
  private readonly producerHandler: (producer: Producer, peer: Peer) => void;
  private readonly producerClosedHandler: (producerId: string) => void;

  constructor(
    readonly claims: MediaClaims,
    readonly room: Room,
    readonly socket: WebSocket,
    private sender: VoiceSender,
    readonly udpPort: number,
  ) {
    this.producerHandler = (producer, peer) => {
      if (!this.claims.self_deaf && peer.claims.session_id !== this.claims.session_id) {
        void this.consumeProducer(producer, peer);
      }
    };
    this.producerClosedHandler = (producerId) => this.closeConsumer(producerId);
  }

  async start(): Promise<void> {
    this.peer = this.room.addPeer(this.claims, this.socket);
    this.directTransport = await this.room.createDirectTransport(this.claims.session_id);
    this.producer = await this.directTransport.produce({
      kind: 'audio',
      rtpParameters: {
        codecs: [{
          mimeType: 'audio/opus',
          payloadType: OPUS_PAYLOAD_TYPE,
          clockRate: 48_000,
          channels: 2,
          parameters: { useinbandfec: 1, usedtx: 1 },
          rtcpFeedback: [],
        }],
        encodings: [{ ssrc: this.ssrc }],
        rtcp: { cname: `miscord-bot-${this.ssrc}`, reducedSize: true },
      },
      appData: {
        source: 'microphone',
        userId: Number(this.claims.sub),
        sessionId: this.claims.session_id,
        isBot: true,
      },
    });
    await this.room.addProducer(this.peer, this.directTransport, this.producer, 'microphone');
    this.room.on('producerAvailable', this.producerHandler);
    this.room.on('producerClosed', this.producerClosedHandler);
    if (!this.claims.self_deaf) {
      for (const descriptor of this.room.descriptors(this.claims.session_id)) {
        const owner = this.room.producerOwner(descriptor.producer_id);
        const producer = owner?.producers.get(descriptor.producer_id);
        if (owner && producer?.kind === 'audio') await this.consumeProducer(producer, owner);
      }
    }
    metrics.botSessions.inc();
  }

  bindRemote(remote: RemoteTuple): void {
    this.remote = remote;
  }

  selectMode(mode: string): void {
    if (!supportedModes().includes(mode as EncryptionMode)) throw new Error('Unsupported encryption mode');
    this.mode = mode as EncryptionMode;
    this.cipher = new RtpCipher(this.mode, this.secretKey);
  }

  acceptPacket(packet: Buffer, remote: RemoteTuple): void {
    if (!this.remote || this.remote.address !== remote.address || this.remote.port !== remote.port) {
      throw new Error('Unexpected UDP source');
    }
    if (!this.cipher) throw new Error('Encryption is not configured');
    if (this.claims.can_speak === false) throw new Error('Bot lacks SPEAK permission');
    const clear = this.cipher.decrypt(packet);
    const header = parseRtpHeader(clear);
    if (header.ssrc !== this.ssrc || header.payloadType !== OPUS_PAYLOAD_TYPE) {
      throw new Error('Unexpected RTP stream');
    }
    this.producer.send(clear);
  }

  sendPacket(packet: Buffer, producerId: string, edge: UdpEdge): void {
    if (!this.remote || !this.cipher) return;
    const ssrc = this.outboundSsrc.get(producerId) ?? randomSsrc();
    this.outboundSsrc.set(producerId, ssrc);
    edge.send(this.cipher.encrypt(rewriteSsrc(packet, ssrc)), this.remote);
  }

  rebind(socket: WebSocket, sender: VoiceSender): void {
    this.peer.socket = socket;
    this.sender = sender;
  }

  close(): void {
    this.room.off('producerAvailable', this.producerHandler);
    this.room.off('producerClosed', this.producerClosedHandler);
    for (const consumer of this.consumers.values()) consumer.close();
    this.consumers.clear();
    this.room.removePeer(this.claims.session_id);
    metrics.botSessions.dec();
  }

  private async consumeProducer(producer: Producer, owner: Peer): Promise<void> {
    if (producer.kind !== 'audio' || this.consumers.has(producer.id)) return;
    const consumer = await this.directTransport.consume({
      producerId: producer.id,
      rtpCapabilities: this.room.router.rtpCapabilities,
    });
    this.consumers.set(producer.id, consumer);
    this.room.addConsumer(this.peer, consumer);
    const ssrc = randomSsrc();
    this.outboundSsrc.set(producer.id, ssrc);
    this.outboundUserIds.set(producer.id, String(owner.claims.sub));
    this.sender.sendOp(11, {
      user_id: owner.claims.sub,
      audio_ssrc: ssrc,
      video_ssrc: 0,
    });
    this.sender.sendOp(5, { speaking: 1, delay: 0, ssrc, user_id: owner.claims.sub });
    consumer.on('rtp', (packet) => this.sendPacket(packet, producer.id, udpEdge));
    consumer.on('producerclose', () => this.closeConsumer(producer.id));
  }

  private closeConsumer(producerId: string): void {
    const userId = this.outboundUserIds.get(producerId);
    this.consumers.get(producerId)?.close();
    this.consumers.delete(producerId);
    this.outboundSsrc.delete(producerId);
    this.outboundUserIds.delete(producerId);
    if (userId) this.sender.sendOp(13, { user_id: userId });
  }
}

export class UdpEdge {
  private socket?: dgram.Socket;
  private port = config.botUdpPortMin;
  private readonly bySsrc = new Map<number, BotMediaSession>();
  private readonly byRemote = new Map<string, BotMediaSession>();

  async start(): Promise<void> {
    const socket = dgram.createSocket('udp4');
    this.socket = socket;
    socket.on('message', (packet, info) => this.handle(packet, { address: info.address, port: info.port }));
    socket.on('error', (error) => console.error('[voice-media] UDP edge error', { message: error.message }));
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(this.port, config.listenIp, () => {
        socket.off('error', reject);
        resolve();
      });
    });
  }

  register(session: BotMediaSession): void {
    this.bySsrc.set(session.ssrc, session);
  }

  unregister(session: BotMediaSession): void {
    this.bySsrc.delete(session.ssrc);
    if (session.remote) this.byRemote.delete(this.remoteKey(session.remote));
  }

  send(packet: Buffer, remote: RemoteTuple): void {
    this.socket?.send(packet, remote.port, remote.address);
  }

  advertisedPort(): number {
    return this.port;
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
    this.bySsrc.clear();
    this.byRemote.clear();
  }

  private handle(packet: Buffer, remote: RemoteTuple): void {
    try {
      if (isDiscoveryPacket(packet)) {
        const session = this.bySsrc.get(discoverySsrc(packet));
        if (!session) return;
        if (session.remote) this.byRemote.delete(this.remoteKey(session.remote));
        session.bindRemote(remote);
        this.byRemote.set(this.remoteKey(remote), session);
        this.send(discoveryResponse(session.ssrc, remote.address, remote.port), remote);
        return;
      }
      this.byRemote.get(this.remoteKey(remote))?.acceptPacket(packet, remote);
    } catch {
      // Invalid, replayed, unauthenticated and wrong-tuple packets are dropped.
    }
  }

  private remoteKey(remote: RemoteTuple): string {
    return `${remote.address}:${remote.port}`;
  }
}

export const udpEdge = new UdpEdge();
export { AES_GCM_MODE, XCHACHA_MODE, supportedModes };
