import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  verify: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  pipelineExec: vi.fn(),
  redisDel: vi.fn(),
  media: [] as any[],
  startGates: [] as Promise<void>[],
  events: [] as string[],
}));

vi.mock('../roomRegistry.js', () => ({ rooms: { acquire: mocks.acquire } }));
vi.mock('../ticketVerifier.js', () => ({
  ticketVerifier: {
    verify: mocks.verify,
    redis: {
      lrange: vi.fn(async () => []), del: mocks.redisDel,
      pipeline: vi.fn(() => ({
        rpush: vi.fn(), ltrim: vi.fn(), pexpire: vi.fn(), exec: mocks.pipelineExec,
      })),
    },
  },
}));
vi.mock('./udpEdge.js', () => ({
  BotMediaSession: class {
    readonly index = mocks.media.length;
    readonly ssrc = 1000 + this.index;
    readonly secretKey = Buffer.alloc(32);
    readonly close = vi.fn();
    readonly selectMode = vi.fn();
    readonly setSpeaking = vi.fn(async () => undefined);
    readonly rebind = vi.fn();
    constructor() { mocks.media.push(this); }
    async start(): Promise<void> {
      mocks.events.push(`start-${this.index}`);
      const gate = mocks.startGates.shift();
      if (gate) await gate;
      mocks.events.push(`end-${this.index}`);
    }
  },
  supportedModes: vi.fn(() => ['aead_xchacha20_poly1305_rtpsize']),
  udpEdge: {
    advertisedPort: vi.fn(() => 20100), register: mocks.register, unregister: mocks.unregister,
  },
}));

import { BotVoiceGateway, VoiceConnection, VoiceTaskQueue } from './voiceGateway.js';


class RejectedSocket {
  output = '';
  destroyed = false;

  write(value: string): void {
    this.output += value;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

class VoiceSocket {
  readyState = 1;
  readonly send = vi.fn();
  readonly close = vi.fn();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.media.length = 0;
  mocks.startGates.length = 0;
  mocks.events.length = 0;
  mocks.pipelineExec.mockResolvedValue([]);
  mocks.redisDel.mockResolvedValue(0);
});

describe('Voice Gateway version boundary', () => {
  it.each(['/ws/voice-gateway', '/ws/voice-gateway?v=8', '/ws/voice-gateway?v=10'])(
    'rejects legacy URL %s',
    (url) => {
      const gateway = new BotVoiceGateway();
      const socket = new RejectedSocket();
      const handled = gateway.handleUpgrade({ url } as never, socket as never, Buffer.alloc(0));
      expect(handled).toBe(true);
      expect(socket.output).toContain('400 Bad Request');
      expect(socket.output).toContain('v1 required');
      expect(socket.destroyed).toBe(true);
      gateway.closeAll();
    },
  );
});

describe('Voice Gateway message queue', () => {
  it('serializes a second Identify-shaped task behind a pending first task', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const queue = new VoiceTaskQueue();
    const first = queue.run(async () => {
      events.push('identify-start');
      await gate;
      events.push('identify-end');
    });
    const second = queue.run(async () => { events.push('duplicate-identify'); });

    await vi.waitFor(() => expect(events).toEqual(['identify-start']));
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['identify-start', 'identify-end', 'duplicate-identify']);
  });

  it('rejects an unbounded burst while one message is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queue = new VoiceTaskQueue(2);
    const first = queue.run(() => gate);
    const second = queue.run(async () => undefined);

    await expect(queue.run(async () => undefined)).rejects.toThrow('queue limit exceeded');
    release();
    await Promise.all([first, second]);
  });
});

describe('Voice Gateway session setup', () => {
  it('serializes two sockets identifying the same bot session', async () => {
    const firstGate = deferred();
    const releases = [vi.fn(), vi.fn()];
    const claims = {
      sub: '42', jti: 'jti', channel_id: 500, session_id: 'shared-session',
      room_epoch: 'epoch-1', username: 'bot', protocol_version: 1,
      is_bot: true, guild_id: 500,
    };
    mocks.verify.mockResolvedValue(claims);
    mocks.acquire
      .mockResolvedValueOnce({ room: {}, release: releases[0] })
      .mockResolvedValueOnce({ room: {}, release: releases[1] });
    mocks.startGates.push(firstGate.promise);
    const first = new VoiceConnection(new VoiceSocket() as never);
    const second = new VoiceConnection(new VoiceSocket() as never);
    const payload = {
      op: 0,
      d: {
        token: 'token', session_id: 'shared-session', user_id: '42', server_id: '500',
        max_dave_protocol_version: 1, e2ee_public_key: 'cHVibGlj',
      },
    };

    const firstSetup = first.handle(payload);
    await vi.waitFor(() => expect(mocks.events).toEqual(['start-0']));
    const secondSetup = second.handle(payload);
    await Promise.resolve();
    expect(mocks.media).toHaveLength(1);

    firstGate.resolve();
    await Promise.all([firstSetup, secondSetup]);
    expect(mocks.events).toEqual(['start-0', 'end-0', 'start-1', 'end-1']);
    expect(mocks.media[0].close).toHaveBeenCalledOnce();
    expect(mocks.unregister).toHaveBeenCalledWith(mocks.media[0]);
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);

    const timeout = vi.spyOn(globalThis, 'setTimeout');
    first.onClose();
    expect(timeout).not.toHaveBeenCalled();
    timeout.mockRestore();
    const cleanup = new BotVoiceGateway();
    cleanup.revoke('shared-session');
    cleanup.closeAll();
  });

  it('contains transient Redis failures from fire-and-forget persistence and cleanup', async () => {
    const claims = {
      sub: '43', jti: 'jti-redis', channel_id: 500, session_id: 'redis-session',
      room_epoch: 'epoch-1', username: 'bot', protocol_version: 1,
      is_bot: true, guild_id: 500,
    };
    mocks.verify.mockResolvedValue(claims);
    mocks.acquire.mockResolvedValue({ room: {}, release: vi.fn() });
    mocks.pipelineExec.mockRejectedValueOnce(new Error('Redis write failed'));
    mocks.redisDel.mockRejectedValueOnce(new Error('Redis delete failed'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    try {
      const connection = new VoiceConnection(new VoiceSocket() as never);
      await connection.handle({
        op: 0,
        d: {
          token: 'token', session_id: 'redis-session', user_id: '43', server_id: '500',
          max_dave_protocol_version: 1, e2ee_public_key: 'cHVibGlj',
        },
      });
      const cleanup = new BotVoiceGateway();
      cleanup.revoke('redis-session');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      cleanup.closeAll();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
