import { TextEncoder } from 'node:util';

import { Redis } from 'ioredis';
import { jwtVerify } from 'jose';

import { config } from './config.js';
import { metrics } from './metrics.js';
import type { MediaClaims, SoundboardClaims } from './types.js';

export class TicketVerifier {
  readonly redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });
  private readonly secret = new TextEncoder().encode(config.jwtSecret);

  async start(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    await this.redis.ping();
  }

  isReady(): boolean {
    return this.redis.status === 'ready';
  }

  async verify(ticket: string, consume = true): Promise<MediaClaims> {
    try {
      const result = await jwtVerify(ticket, this.secret, {
        audience: config.jwtAudience,
        issuer: 'miscord-api-v1',
        algorithms: ['HS256'],
      });
      const payload = result.payload as unknown as MediaClaims;
      if (
        payload.protocol_version !== 1 ||
        !payload.jti ||
        !payload.session_id ||
        !payload.room_epoch ||
        !Number.isSafeInteger(Number(payload.sub)) ||
        !Number.isSafeInteger(Number(payload.channel_id))
      ) {
        throw new Error('Invalid ticket claims');
      }
      if (consume) {
        const accepted = await this.redis.set(
          `voice:v1:ticket:${payload.jti}`,
          payload.session_id,
          'EX',
          120,
          'NX',
        );
        if (accepted !== 'OK') throw new Error('Media ticket was already used');
      }
      return payload;
    } catch (error) {
      metrics.authFailures.inc();
      throw error;
    }
  }

  async verifySoundboard(ticket: string): Promise<SoundboardClaims> {
    try {
      const result = await jwtVerify(ticket, this.secret, {
        audience: config.jwtAudience,
        issuer: 'miscord-api-v1',
        algorithms: ['HS256'],
      });
      const payload = result.payload as unknown as SoundboardClaims;
      if (
        payload.protocol_version !== 1
        || payload.purpose !== 'soundboard'
        || !payload.jti
        || !payload.session_id
        || !Number.isSafeInteger(Number(payload.sub))
        || !Number.isSafeInteger(Number(payload.channel_id))
        || !Number.isSafeInteger(Number(payload.sound_id))
        || !Number.isSafeInteger(Number(payload.duration_ms))
        || payload.duration_ms < 1
        || payload.duration_ms > 5_000
      ) throw new Error('Invalid soundboard ticket claims');
      const accepted = await this.redis.set(
        `voice:v1:soundboard-ticket:${payload.jti}`,
        payload.session_id,
        'EX',
        30,
        'NX',
      );
      if (accepted !== 'OK') throw new Error('Soundboard ticket was already used');
      return payload;
    } catch (error) {
      metrics.authFailures.inc();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

export const ticketVerifier = new TicketVerifier();
