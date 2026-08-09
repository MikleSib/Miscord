import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';
import { TextEncoder } from 'node:util';

import { SignJWT } from 'jose';
import sodium from 'sodium-native';
import WebSocket from 'ws';

const baseUrl = process.env.VOICE_SMOKE_WS_URL ?? 'ws://127.0.0.1:3011';
const jwtSecret = process.env.VOICE_MEDIA_JWT_SECRET ?? 'local-voice-media-secret-change-me-32-bytes';
const secret = new TextEncoder().encode(jwtSecret);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ticket(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    jti: randomUUID(),
    channel_id: 880001,
    session_id: randomUUID(),
    room_epoch: 'local-smoke-epoch',
    username: 'local_voice_probe',
    display_name: 'Local Voice Probe',
    avatar_url: null,
    is_bot: false,
    self_mute: false,
    self_deaf: false,
    can_speak: true,
    protocol_version: 1,
    ...overrides,
  };
  const value = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('miscord-api-v1')
    .setAudience('miscord-voice-media')
    .setSubject(String(overrides.sub ?? 880101))
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(secret);
  return { value, claims };
}

function openSocket(path) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl}${path}`);
    const timer = setTimeout(() => reject(new Error(`WebSocket open timeout: ${path}`)), 5_000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

function waitMessage(socket, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('WebSocket message timeout'));
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

async function mediaSmoke() {
  const issued = await ticket();
  const socket = await openSocket('/ws/media');
  socket.send(JSON.stringify({ type: 'identify', request_id: 'identify', ticket: issued.value }));
  const identified = await waitMessage(socket, (message) => message.request_id === 'identify');
  assert(identified.type === 'identify_ok' && identified.protocol_version === 1, 'Media identify failed');

  for (const direction of ['send', 'recv']) {
    const requestId = `transport-${direction}`;
    socket.send(JSON.stringify({ type: 'create_transport', request_id: requestId, direction }));
    const response = await waitMessage(socket, (message) => message.request_id === requestId);
    assert(response.type === 'create_transport_ok' && response.transport_id, `${direction} transport failed`);
  }

  socket.send(JSON.stringify({ type: 'ping', request_id: 'ping' }));
  const pong = await waitMessage(socket, (message) => message.request_id === 'ping');
  assert(pong.type === 'ping_ok' && Number.isFinite(pong.now), 'Media ping failed');

  const replay = await openSocket('/ws/media');
  replay.send(JSON.stringify({ type: 'identify', request_id: 'replay', ticket: issued.value }));
  const denied = await waitMessage(replay, (message) => message.request_id === 'replay');
  assert(denied.type === 'error', 'Reused media ticket was accepted');
  replay.close();
  socket.close();
}

function discovery(socket, port, ssrc) {
  return new Promise((resolve, reject) => {
    const request = Buffer.alloc(74);
    request.writeUInt16BE(1, 0);
    request.writeUInt16BE(70, 2);
    request.writeUInt32BE(ssrc, 4);
    const timer = setTimeout(() => reject(new Error('UDP discovery timeout')), 5_000);
    socket.once('message', (response) => {
      clearTimeout(timer);
      assert(response.length === 74 && response.readUInt16BE(0) === 2, 'Invalid UDP discovery response');
      resolve({ address: '127.0.0.1', port: response.readUInt16BE(72) });
    });
    socket.send(request, port, '127.0.0.1');
  });
}

function encryptedSilence(key, ssrc) {
  const header = Buffer.alloc(12);
  header[0] = 0x80;
  header[1] = 120;
  header.writeUInt16BE(1, 2);
  header.writeUInt32BE(960, 4);
  header.writeUInt32BE(ssrc, 8);
  const opus = Buffer.from([0xf8, 0xff, 0xfe]);
  const nonce = Buffer.alloc(24);
  const ciphertext = Buffer.alloc(opus.length + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ciphertext, opus, header, null, nonce, key);
  return Buffer.concat([header, ciphertext, Buffer.alloc(4)]);
}

async function botSmoke() {
  const userId = 880201;
  const guildId = 880301;
  const issued = await ticket({
    sub: userId,
    channel_id: 880002,
    room_epoch: 'local-bot-smoke-epoch',
    is_bot: true,
    self_deaf: true,
    application_id: 880401,
    guild_id: guildId,
  });
  let socket = await openSocket('/ws/voice-gateway?v=1');
  const hello = await waitMessage(socket, (message) => message.op === 8);
  assert(hello.d?.heartbeat_interval > 0, 'Voice Hello failed');
  socket.send(JSON.stringify({
    op: 0,
    d: {
      server_id: String(guildId),
      user_id: String(userId),
      session_id: issued.claims.session_id,
      token: issued.value,
      max_dave_protocol_version: 0,
    },
  }));
  const ready = await waitMessage(socket, (message) => message.op === 2);
  assert(Number.isInteger(ready.d?.ssrc) && ready.d.ssrc > 0, 'Voice Ready has invalid SSRC');
  assert(ready.d?.modes?.includes('aead_xchacha20_poly1305_rtpsize'), 'XChaCha mode missing');

  const udp = dgram.createSocket('udp4');
  await new Promise((resolve) => udp.bind(0, '0.0.0.0', resolve));
  const remote = await discovery(udp, ready.d.port, ready.d.ssrc);
  socket.send(JSON.stringify({
    op: 1,
    d: {
      protocol: 'udp',
      data: { address: remote.address, port: remote.port, mode: 'aead_xchacha20_poly1305_rtpsize' },
    },
  }));
  const description = await waitMessage(socket, (message) => message.op === 4);
  assert(description.d?.dave_protocol_version === 0, 'Unexpected DAVE version');
  const key = Buffer.from(description.d.secret_key);
  assert(key.length === 32, 'Voice secret key is not 32 bytes');
  socket.send(JSON.stringify({ op: 5, d: { speaking: 1, delay: 0, ssrc: ready.d.ssrc } }));
  udp.send(encryptedSilence(key, ready.d.ssrc), ready.d.port, '127.0.0.1');

  socket.send(JSON.stringify({ op: 3, d: { t: Date.now(), seq_ack: description.seq } }));
  const heartbeat = await waitMessage(socket, (message) => message.op === 6);
  assert(Number.isInteger(heartbeat.d?.seq_ack), 'Voice heartbeat ACK failed');
  const lastSequence = heartbeat.d.seq_ack;
  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 100));

  socket = await openSocket('/ws/voice-gateway?v=1');
  await waitMessage(socket, (message) => message.op === 8);
  socket.send(JSON.stringify({
    op: 7,
    d: { server_id: String(guildId), session_id: issued.claims.session_id, token: issued.value, seq_ack: lastSequence },
  }));
  const resumed = await waitMessage(socket, (message) => message.op === 9);
  assert(resumed.d?.session_id === issued.claims.session_id, 'Voice resume failed');
  socket.close();
  udp.close();
  return issued.claims.session_id;
}

await mediaSmoke();
const botSessionId = await botSmoke();
console.log(JSON.stringify({ ok: true, protocol_version: 1, bot_session_id: botSessionId }));
