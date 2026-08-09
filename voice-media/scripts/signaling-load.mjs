import { randomUUID } from 'node:crypto';
import { TextEncoder } from 'node:util';

import { SignJWT } from 'jose';
import WebSocket from 'ws';

const users = Number.parseInt(process.env.LOAD_USERS ?? '1000', 10);
const roomCount = Number.parseInt(process.env.LOAD_ROOMS ?? '100', 10);
const concurrency = Number.parseInt(process.env.LOAD_CONCURRENCY ?? '50', 10);
const holdMs = Number.parseInt(process.env.LOAD_HOLD_MS ?? '0', 10);
const pingIntervalMs = Number.parseInt(process.env.LOAD_PING_INTERVAL_MS ?? '15000', 10);
const baseUrl = process.env.VOICE_SMOKE_WS_URL ?? 'ws://127.0.0.1:3011';
const jwtSecret = process.env.VOICE_MEDIA_JWT_SECRET ?? 'local-voice-media-secret-change-me-32-bytes';
const secret = new TextEncoder().encode(jwtSecret);
const runId = randomUUID();
const sockets = [];
const durations = [];
const failures = [];
const disconnectedDuringHold = new Set();
let intentionalClose = false;

function waitMessage(socket, predicate, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('message timeout'));
    }, timeoutMs);
    const onMessage = (raw) => {
      const payload = JSON.parse(raw.toString());
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(payload);
    };
    socket.on('message', onMessage);
  });
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl}/ws/media`);
    const timer = setTimeout(() => reject(new Error('open timeout')), 10_000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

async function issueTicket(index) {
  const now = Math.floor(Date.now() / 1000);
  const room = index % roomCount;
  return new SignJWT({
    jti: randomUUID(),
    channel_id: 910000 + room,
    session_id: `${runId}-${index}`,
    room_epoch: `${runId}-room-${room}`,
    username: `load_user_${index}`,
    is_bot: false,
    self_mute: false,
    self_deaf: false,
    can_speak: true,
    protocol_version: 1,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('miscord-api-v1')
    .setAudience('miscord-voice-media')
    .setSubject(String(920000 + index))
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(secret);
}

async function rpc(socket, type, requestId, data = {}) {
  socket.send(JSON.stringify({ type, request_id: requestId, ...data }));
  const response = await waitMessage(socket, (message) => message.request_id === requestId);
  if (response.type === 'error') throw new Error(response.message ?? `${type} failed`);
  return response;
}

async function connectUser(index) {
  const started = performance.now();
  const socket = await openSocket();
  const token = await issueTicket(index);
  await rpc(socket, 'identify', `identify-${index}`, { ticket: token });
  await rpc(socket, 'create_transport', `send-${index}`, { direction: 'send' });
  await rpc(socket, 'create_transport', `recv-${index}`, { direction: 'recv' });
  socket.once('close', () => {
    if (!intentionalClose) disconnectedDuringHold.add(index);
  });
  socket.once('error', () => {
    if (!intentionalClose) disconnectedDuringHold.add(index);
  });
  durations.push(performance.now() - started);
  sockets.push(socket);
}

let cursor = 0;
async function worker() {
  while (cursor < users) {
    const index = cursor++;
    try {
      await connectUser(index);
    } catch (error) {
      failures.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, users) }, () => worker()));
const sorted = [...durations].sort((left, right) => left - right);
const p95 = sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : Number.POSITIVE_INFINITY;
const successRate = users > 0 ? durations.length / users : 0;

let pingTimer;
if (holdMs > 0 && sockets.length > 0) {
  pingTimer = setInterval(() => {
    const pingId = `hold-ping-${Date.now()}`;
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping', request_id: pingId }));
      }
    }
  }, pingIntervalMs);
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  clearInterval(pingTimer);
}

const connectedAtEnd = sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length;
const survivalRate = sockets.length > 0 ? connectedAtEnd / sockets.length : 0;
intentionalClose = true;
for (const socket of sockets) socket.close();
await new Promise((resolve) => setTimeout(resolve, 500));

const summary = {
  requested: users,
  connected: durations.length,
  failed: failures.length,
  success_percent: Number((successRate * 100).toFixed(2)),
  p95_join_ms: Number(p95.toFixed(1)),
  rooms: roomCount,
  transports_per_peer: 2,
  hold_ms: holdMs,
  connected_at_end: connectedAtEnd,
  survived_percent: Number((survivalRate * 100).toFixed(2)),
  disconnected_during_hold: disconnectedDuringHold.size,
  first_failures: failures.slice(0, 5),
};
console.log(JSON.stringify(summary));
if (successRate < 0.99 || p95 >= 3_000 || survivalRate < 0.99) process.exitCode = 1;
