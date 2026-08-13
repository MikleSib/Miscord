import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaRpcClient } from '../mediaRpcClient';


class FakeWebSocket {
  static readonly OPEN = 1;
  readonly sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;

  constructor(readonly url: string) {
    instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(raw: string): void {
    this.sent.push(raw);
    const payload = JSON.parse(raw);
    queueMicrotask(() => this.onmessage?.({
      data: JSON.stringify({
        type: `${payload.type}_ok`,
        request_id: payload.request_id,
        protocol_version: 1,
      }),
    }));
  }

  close(): void {
    this.readyState = 3;
  }
}

const instances: FakeWebSocket[] = [];

afterEach(() => {
  instances.length = 0;
  vi.unstubAllGlobals();
});

describe('MediaRpcClient', () => {
  it('sends the one-time ticket in the first frame, never in the URL', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = new MediaRpcClient();
    const response = await client.connect('ws://localhost/ws/media', 'one-time-ticket');
    const socket = instances[0];
    expect(socket.url).toBe('ws://localhost/ws/media');
    expect(socket.url).not.toContain('one-time-ticket');
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: 'identify',
      ticket: 'one-time-ticket',
    });
    expect(response.protocol_version).toBe(1);
    client.close();
  });

  it('does not report an intentional client close as a connection failure', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = new MediaRpcClient();
    await client.connect('ws://localhost/ws/media', 'one-time-ticket');
    const onFailure = vi.fn();
    client.on('connection_failed', onFailure);

    client.close();

    expect(onFailure).not.toHaveBeenCalled();
  });

  it('reports an unexpected remote close as a connection failure', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = new MediaRpcClient();
    await client.connect('ws://localhost/ws/media', 'one-time-ticket');
    const onFailure = vi.fn();
    client.on('connection_failed', onFailure);

    instances[0].onclose?.({ reason: 'Media service unavailable' });

    expect(onFailure).toHaveBeenCalledWith({ message: 'Media service unavailable' });
    client.close();
  });
});
