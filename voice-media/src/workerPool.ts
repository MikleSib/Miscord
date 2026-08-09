import * as mediasoup from 'mediasoup';
import type { Router, Worker, WebRtcServer, WorkerLogLevel } from 'mediasoup/types';

import { config } from './config.js';
import { metrics } from './metrics.js';

const mediaCodecs = [
  {
    kind: 'audio' as const,
    mimeType: 'audio/opus',
    clockRate: 48_000,
    channels: 2,
    parameters: { useinbandfec: 1, usedtx: 1, 'sprop-stereo': 1 },
  },
  {
    kind: 'video' as const,
    mimeType: 'video/VP8',
    clockRate: 90_000,
    parameters: {},
    rtcpFeedback: [
      { type: 'nack' },
      { type: 'nack', parameter: 'pli' },
      { type: 'ccm', parameter: 'fir' },
      { type: 'goog-remb' },
      { type: 'transport-cc' },
    ],
  },
  {
    kind: 'video' as const,
    mimeType: 'video/H264',
    clockRate: 90_000,
    parameters: { 'packetization-mode': 1, 'level-asymmetry-allowed': 1 },
    rtcpFeedback: [
      { type: 'nack' },
      { type: 'nack', parameter: 'pli' },
      { type: 'ccm', parameter: 'fir' },
      { type: 'goog-remb' },
      { type: 'transport-cc' },
    ],
  },
];

interface WorkerSlot {
  worker: Worker;
  webRtcServer: WebRtcServer;
  rooms: number;
  consumers: number;
  port: number;
}

export class WorkerPool {
  private slots: WorkerSlot[] = [];
  private ready = false;

  async start(): Promise<void> {
    for (let index = 0; index < config.workerCount; index += 1) {
      const port = config.webRtcPortMin + index;
      const worker = await mediasoup.createWorker({
        logLevel: config.logLevel as WorkerLogLevel,
        logTags: ['ice', 'dtls', 'rtp', 'rtcp'],
      });
      worker.on('died', (error) => {
        metrics.workerDeaths.inc();
        this.ready = false;
        console.error('[voice-media] mediasoup worker died', { pid: worker.pid, error: error.message });
        setTimeout(() => process.exit(1), 500).unref();
      });
      const webRtcServer = await worker.createWebRtcServer({
        listenInfos: [
          {
            protocol: 'udp',
            ip: config.listenIp,
            announcedAddress: config.announcedAddress,
            port,
          },
          {
            protocol: 'tcp',
            ip: config.listenIp,
            announcedAddress: config.announcedAddress,
            port,
          },
        ],
      });
      this.slots.push({ worker, webRtcServer, rooms: 0, consumers: 0, port });
    }
    this.ready = this.slots.length === config.workerCount;
  }

  isReady(): boolean {
    return this.ready && this.slots.every((slot) => !slot.worker.closed && !slot.webRtcServer.closed);
  }

  async createRouter(): Promise<{ router: Router; webRtcServer: WebRtcServer; workerPid: number }> {
    const slot = [...this.slots].sort((left, right) => {
      const loadLeft = left.consumers + left.rooms * 8;
      const loadRight = right.consumers + right.rooms * 8;
      return loadLeft - loadRight;
    })[0];
    if (!slot) throw new Error('No media worker is ready');
    const router = await slot.worker.createRouter({ mediaCodecs });
    slot.rooms += 1;
    router.once('@close', () => {
      slot.rooms = Math.max(0, slot.rooms - 1);
    });
    return { router, webRtcServer: slot.webRtcServer, workerPid: slot.worker.pid };
  }

  adjustConsumers(workerPid: number, delta: number): void {
    const slot = this.slots.find((candidate) => candidate.worker.pid === workerPid);
    if (slot) slot.consumers = Math.max(0, slot.consumers + delta);
  }

  async close(): Promise<void> {
    this.ready = false;
    for (const slot of this.slots) slot.worker.close();
    this.slots = [];
  }
}

export const workerPool = new WorkerPool();
