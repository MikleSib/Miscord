import http from 'node:http';

import { botVoiceGateway } from './bot/voiceGateway.js';
import { udpEdge } from './bot/udpEdge.js';
import { config } from './config.js';
import { mediaGateway } from './mediaGateway.js';
import { metrics } from './metrics.js';
import { rooms } from './room.js';
import { ticketVerifier } from './ticketVerifier.js';
import { workerPool } from './workerPool.js';

let shuttingDown = false;
const revokeSubscriber = ticketVerifier.redis.duplicate();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://voice-media.local');
  if (url.pathname === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', protocol_version: 1 }));
    return;
  }
  if (url.pathname === '/readyz') {
    const ready = !shuttingDown && workerPool.isReady() && ticketVerifier.isReady();
    response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: ready ? 'ready' : 'not_ready', rooms: rooms.size() }));
    return;
  }
  if (url.pathname === '/metrics') {
    response.writeHead(200, { 'content-type': metrics.registry.contentType });
    response.end(await metrics.registry.metrics());
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not_found' }));
});

server.on('upgrade', (request, socket, head) => {
  if (mediaGateway.handleUpgrade(request, socket, head)) return;
  if (botVoiceGateway.handleUpgrade(request, socket, head)) return;
  socket.destroy();
});

async function start(): Promise<void> {
  await ticketVerifier.start();
  await revokeSubscriber.connect();
  await revokeSubscriber.subscribe('voice:v1:bot:revoke');
  revokeSubscriber.on('message', (_channel, sessionId) => botVoiceGateway.revoke(sessionId));
  await workerPool.start();
  await udpEdge.start();
  await new Promise<void>((resolve) => server.listen(config.httpPort, config.listenIp, resolve));
  console.log('[voice-media] ready', {
    protocolVersion: 1,
    workers: config.workerCount,
    httpPort: config.httpPort,
    webRtcPorts: `${config.webRtcPortMin}-${config.webRtcPortMin + config.workerCount - 1}`,
    botUdpPort: udpEdge.advertisedPort(),
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[voice-media] shutdown requested', { signal });
  server.close();
  botVoiceGateway.closeAll();
  udpEdge.close();
  rooms.close();
  await workerPool.close();
  await ticketVerifier.close();
  await revokeSubscriber.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((error) => {
  console.error('[voice-media] startup failed', { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
