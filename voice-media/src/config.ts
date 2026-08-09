import os from 'node:os';

function integer(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function required(name: string, developmentFallback = ''): string {
  const value = process.env[name]?.trim() || developmentFallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const workerCount = Math.min(
  integer('VOICE_MEDIA_WORKERS', Math.max(1, Math.min(12, os.cpus().length - 1))),
  16,
);

export const config = {
  environment: process.env.NODE_ENV ?? 'development',
  httpPort: integer('VOICE_MEDIA_HTTP_PORT', 3001),
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
  jwtSecret: required('VOICE_MEDIA_JWT_SECRET', 'local-voice-media-secret-change-me-32-bytes'),
  jwtAudience: process.env.VOICE_MEDIA_AUDIENCE ?? 'miscord-voice-media',
  announcedAddress: process.env.VOICE_MEDIA_ANNOUNCED_ADDRESS ?? '127.0.0.1',
  listenIp: process.env.VOICE_MEDIA_LISTEN_IP ?? '0.0.0.0',
  workerCount,
  webRtcPortMin: integer('VOICE_MEDIA_WEBRTC_PORT_MIN', 20000),
  webRtcPortMax: integer('VOICE_MEDIA_WEBRTC_PORT_MAX', 20015),
  botUdpPortMin: integer('VOICE_MEDIA_BOT_UDP_PORT_MIN', 20100),
  botUdpPortMax: integer('VOICE_MEDIA_BOT_UDP_PORT_MAX', 20103),
  maxActiveSpeakers: integer('VOICE_MAX_ACTIVE_SPEAKERS', 4),
  maxScreenShares: integer('VOICE_MAX_SCREEN_SHARES_PER_NODE', 10),
  initialOutgoingBitrate: integer('VOICE_INITIAL_OUTGOING_BITRATE', 1_000_000),
  maxIncomingBitrate: integer('VOICE_MAX_INCOMING_BITRATE', 12_000_000),
  logLevel: (process.env.VOICE_MEDIA_LOG_LEVEL ?? 'warn') as 'debug' | 'warn' | 'error' | 'none',
};

if (config.workerCount > config.webRtcPortMax - config.webRtcPortMin + 1) {
  throw new Error('VOICE_MEDIA_WORKERS exceeds the configured WebRTC port range');
}

if (config.environment === 'production' && config.jwtSecret.includes('change-me')) {
  throw new Error('VOICE_MEDIA_JWT_SECRET must be replaced in production');
}
