import * as mediasoup from 'mediasoup';

import { mediaCodecs } from './workerPool.js';

const worker = await mediasoup.createWorker({ logLevel: 'none' });
const router = await worker.createRouter({
  mediaCodecs,
});
router.close();
worker.close();
console.log('voice-media preflight ok');
