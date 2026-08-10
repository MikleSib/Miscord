import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import WebSocket, { WebSocketServer } from 'ws';

import { config } from '../config.js';
import { rooms } from '../roomRegistry.js';
import { ticketVerifier } from '../ticketVerifier.js';
import type { MediaClaims } from '../types.js';
import { SessionIdentifyQueue } from '../sessionIdentifyQueue.js';
import { BotMediaSession, supportedModes, udpEdge, type VoiceSender } from './udpEdge.js';

const HEARTBEAT_INTERVAL_MS = 45_000;
const RESUME_TTL_MS = 120_000;
const MAX_BUFFERED_EVENTS = 100;
const MAX_PENDING_MESSAGES = 64;
const sessionIdentifyQueue = new SessionIdentifyQueue();

const OP = {
  IDENTIFY: 0,
  SELECT_PROTOCOL: 1,
  READY: 2,
  HEARTBEAT: 3,
  SESSION_DESCRIPTION: 4,
  SPEAKING: 5,
  HEARTBEAT_ACK: 6,
  RESUME: 7,
  HELLO: 8,
  RESUMED: 9,
  CLIENT_CONNECT: 11,
  CLIENT_DISCONNECT: 13,
} as const;

interface VoicePayload {
  op: number;
  d?: Record<string, unknown> | number | null;
  seq?: number;
}

interface BufferedPayload extends VoicePayload {
  seq: number;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function integer(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : undefined;
}

export class VoiceTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private readonly maxPending = MAX_PENDING_MESSAGES) {}

  run(task: () => Promise<void>): Promise<void> {
    if (this.pending >= this.maxPending) {
      return Promise.reject(new Error('Voice message queue limit exceeded'));
    }
    this.pending += 1;
    const result = this.tail.catch(() => undefined).then(task).finally(() => {
      this.pending -= 1;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export class VoiceConnection implements VoiceSender {
  readonly id = randomUUID();
  private record?: SessionRecord;
  private heartbeatAt = Date.now();
  private heartbeatTimer?: NodeJS.Timeout;
  private closed = false;

  constructor(readonly socket: WebSocket) {}

  sendOp(op: number, data: Record<string, unknown>, replayable = true): void {
    if (this.record) this.record.send(this.socket, op, data, replayable);
    else if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ op, d: data }));
  }

  async handle(payload: VoicePayload): Promise<void> {
    if (this.closed) return;
    if (!this.record) {
      if (payload.op === OP.IDENTIFY) await this.identify(payload.d);
      else if (payload.op === OP.RESUME) await this.resume(payload.d);
      else throw new Error('Identify or Resume required');
      return;
    }

    const data = typeof payload.d === 'object' && payload.d ? payload.d : {};
    switch (payload.op) {
      case OP.HEARTBEAT:
        this.heartbeatAt = Date.now();
        this.sendOp(OP.HEARTBEAT_ACK, {
          t: typeof payload.d === 'number' ? payload.d : Date.now(),
          seq_ack: this.record.sequence,
        }, false);
        return;
      case OP.SELECT_PROTOCOL: {
        if (data.protocol !== 'udp') throw new VoiceCloseError(4012, 'UDP protocol required');
        const details = typeof data.data === 'object' && data.data ? data.data as Record<string, unknown> : data;
        const mode = String(details.mode ?? '');
        this.record.media.selectMode(mode);
        this.sendOp(OP.SESSION_DESCRIPTION, {
          mode,
          secret_key: [...this.record.media.secretKey],
          dave_protocol_version: 0,
        });
        return;
      }
      case OP.SPEAKING:
        this.record.speaking = Number(data.speaking ?? 0) !== 0;
        await this.record.media.setSpeaking(this.record.speaking);
        return;
      default:
        throw new VoiceCloseError(4002, 'Unsupported voice opcode');
    }
  }

  onClose(): void {
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.record?.connectionId === this.id) this.record.scheduleCleanup();
  }

  private async identify(raw: unknown): Promise<void> {
    const data = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const token = String(data.token ?? '');
    if (!token) throw new VoiceCloseError(4004, 'Voice token required');
    const claims = await ticketVerifier.verify(token);
    this.assertOpen();
    if (!claims.is_bot) throw new VoiceCloseError(4004, 'Bot voice ticket required');
    if (
      String(claims.session_id) !== String(data.session_id ?? '') ||
      String(claims.sub) !== String(data.user_id ?? '') ||
      String(claims.guild_id ?? claims.channel_id) !== String(data.server_id ?? '')
    ) {
      throw new VoiceCloseError(4004, 'Voice ticket scope mismatch');
    }

    await sessionIdentifyQueue.run(claims.session_id, () => this.establishSession(claims, token));
  }

  private async establishSession(claims: MediaClaims, token: string): Promise<void> {
    this.assertOpen();
    const lease = await rooms.acquire(Number(claims.channel_id), claims.room_epoch);
    let media: BotMediaSession | undefined;
    let record: SessionRecord | undefined;
    try {
      this.assertOpen();
      const previous = sessions.get(claims.session_id);
      if (previous) previous.close(4000, 'Voice session replaced');
      media = new BotMediaSession(claims, lease.room, this.socket, this, udpEdge.advertisedPort());
      await media.start();
      this.assertOpen();
      udpEdge.register(media);
      record = new SessionRecord(claims, digest(token), media, this.id);
      record.connection = this;
      sessions.set(claims.session_id, record);
      this.record = record;
      this.startHeartbeatWatch();
      this.sendOp(OP.READY, {
        ssrc: media.ssrc,
        ip: config.announcedAddress,
        port: udpEdge.advertisedPort(),
        modes: supportedModes(),
        heartbeat_interval: HEARTBEAT_INTERVAL_MS,
        channel_id: String(claims.channel_id),
        dave_protocol_version: 0,
      });
    } catch (error) {
      if (record) record.close(4006, 'Voice session setup failed');
      else if (media) {
        udpEdge.unregister(media);
        media.close();
      }
      this.record = undefined;
      throw error;
    } finally {
      lease.release();
    }
  }

  private async resume(raw: unknown): Promise<void> {
    const data = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const sessionId = String(data.session_id ?? '');
    const token = String(data.token ?? '');
    const record = sessions.get(sessionId);
    if (!record || !token || record.tokenDigest !== digest(token)) {
      throw new VoiceCloseError(4006, 'Voice session is no longer valid');
    }
    record.cancelCleanup();
    record.connection?.socket.close(4000, 'Voice connection replaced');
    record.connection = this;
    record.connectionId = this.id;
    record.media.rebind(this.socket, this);
    this.record = record;
    this.startHeartbeatWatch();
    const ack = integer(data.seq_ack) ?? integer(data.seq) ?? -1;
    this.sendOp(OP.RESUMED, { session_id: sessionId });
    await record.replay(this.socket, ack);
  }

  private startHeartbeatWatch(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.heartbeatAt > HEARTBEAT_INTERVAL_MS * 2) {
        this.socket.close(4009, 'Voice heartbeat timed out');
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  private assertOpen(): void {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      throw new VoiceCloseError(4006, 'Voice connection closed');
    }
  }
}

class SessionRecord {
  sequence = 0;
  speaking = false;
  connection?: VoiceConnection;
  connectionId: string;
  cleanupTimer?: NodeJS.Timeout;
  private readonly buffer: BufferedPayload[] = [];
  private closed = false;

  constructor(
    readonly claims: MediaClaims,
    readonly tokenDigest: string,
    readonly media: BotMediaSession,
    connectionId: string,
  ) {
    this.connectionId = connectionId;
  }

  send(socket: WebSocket, op: number, data: Record<string, unknown>, replayable: boolean): void {
    const payload: BufferedPayload = { op, d: data, seq: ++this.sequence };
    if (replayable) {
      this.buffer.push(payload);
      if (this.buffer.length > MAX_BUFFERED_EVENTS) this.buffer.shift();
      void this.persist(payload).catch(() => undefined);
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  async replay(socket: WebSocket, after: number): Promise<void> {
    const stored = await ticketVerifier.redis.lrange(this.resumeKey(), 0, -1);
    const recovered = stored.map((raw) => JSON.parse(raw) as BufferedPayload);
    const payloads = recovered.length ? recovered : this.buffer;
    for (const payload of payloads) {
      if (payload.seq > after && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    }
  }

  scheduleCleanup(): void {
    if (this.closed) return;
    this.cancelCleanup();
    this.cleanupTimer = setTimeout(() => this.close(4006, 'Voice resume window expired'), RESUME_TTL_MS);
    this.cleanupTimer.unref();
  }

  cancelCleanup(): void {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelCleanup();
    this.connection?.socket.close(code, reason);
    udpEdge.unregister(this.media);
    this.media.close();
    if (sessions.get(this.claims.session_id) === this) sessions.delete(this.claims.session_id);
    void ticketVerifier.redis.del(this.resumeKey()).catch(() => undefined);
  }

  private resumeKey(): string {
    return `voice:v1:bot:resume:${this.claims.session_id}`;
  }

  private async persist(payload: BufferedPayload): Promise<void> {
    const pipeline = ticketVerifier.redis.pipeline();
    pipeline.rpush(this.resumeKey(), JSON.stringify(payload));
    pipeline.ltrim(this.resumeKey(), -MAX_BUFFERED_EVENTS, -1);
    pipeline.pexpire(this.resumeKey(), RESUME_TTL_MS);
    await pipeline.exec();
  }
}

class VoiceCloseError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

const sessions = new Map<string, SessionRecord>();

export class BotVoiceGateway {
  readonly server = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  constructor() {
    this.server.on('connection', (socket) => this.handle(socket));
  }

  handleUpgrade(request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): boolean {
    const url = new URL(request.url ?? '/', 'http://voice-media.local');
    if (url.pathname !== '/ws/voice-gateway') return false;
    if (url.searchParams.get('v') !== '1') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\nVoice Gateway v1 required');
      socket.destroy();
      return true;
    }
    this.server.handleUpgrade(request, socket, head, (websocket) => {
      this.server.emit('connection', websocket, request);
    });
    return true;
  }

  closeAll(): void {
    for (const record of [...sessions.values()]) record.close(4015, 'Media service shutting down');
    this.server.close();
  }

  revoke(sessionId: string): void {
    sessions.get(sessionId)?.close(4014, 'Voice session revoked');
  }

  private handle(socket: WebSocket): void {
    const connection = new VoiceConnection(socket);
    const messages = new VoiceTaskQueue();
    socket.send(JSON.stringify({
      op: OP.HELLO,
      d: { heartbeat_interval: HEARTBEAT_INTERVAL_MS, _trace: ['miscord-voice-gateway-v1'] },
    }));
    const identifyTimer = setTimeout(() => socket.close(4003, 'Identify or Resume required'), 15_000);
    socket.on('message', (raw) => {
      void messages.run(async () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
          const payload = JSON.parse(raw.toString()) as VoicePayload;
          if (!Number.isInteger(payload.op)) throw new Error('Voice opcode required');
          await connection.handle(payload);
          clearTimeout(identifyTimer);
        } catch (error) {
          const close = error instanceof VoiceCloseError
            ? error : new VoiceCloseError(4002, 'Invalid voice payload');
          socket.close(close.code, close.message);
        }
      }).catch(() => socket.close(4008, 'Voice message queue limit exceeded'));
    });
    socket.on('close', () => {
      clearTimeout(identifyTimer);
      connection.onClose();
    });
    socket.on('error', () => socket.close());
  }
}

export const botVoiceGateway = new BotVoiceGateway();
