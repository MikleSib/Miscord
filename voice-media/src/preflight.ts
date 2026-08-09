import * as mediasoup from 'mediasoup';

const worker = await mediasoup.createWorker({ logLevel: 'none' });
const router = await worker.createRouter({
  mediaCodecs: [{ kind: 'audio', mimeType: 'audio/opus', clockRate: 48_000, channels: 2 }],
});
router.close();
worker.close();
console.log('voice-media preflight ok');
