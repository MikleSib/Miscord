import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedWebSocketService } from '../unifiedWebSocketService';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  readonly sent: Record<string, unknown>[] = [];

  constructor(readonly url: string) { instances.push(this); }
  send(payload: string): void { this.sent.push(JSON.parse(payload)); }
  open(): void { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  receive(payload: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  close(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

const instances: FakeWebSocket[] = [];

describe('UnifiedWebSocketService readiness handshake', () => {
  beforeEach(() => {
    instances.length = 0;
    vi.stubGlobal('window', {});
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does not report connected until Gateway confirms protocol v1 identify', async () => {
    const service = new UnifiedWebSocketService();
    service.connect('test-token');
    const socket = instances[0];
    const ready = service.waitUntilReady(1_000);

    socket.open();
    expect(service.isConnected()).toBe(false);
    expect(socket.sent).toEqual([{ type: 'identify', token: 'test-token' }]);

    socket.receive({ type: 'identified', protocol_version: 1 });
    await ready;
    expect(service.isConnected()).toBe(true);
    service.disconnect();
  });

  it('subscribes channels only after identify succeeds', async () => {
    const service = new UnifiedWebSocketService();
    service.subscribeChannel(42);
    service.connect('test-token');
    const socket = instances[0];
    socket.open();
    expect(socket.sent).toHaveLength(1);

    socket.receive({ type: 'identified', protocol_version: 1 });
    await service.waitUntilReady();
    expect(socket.sent[1]).toEqual({ type: 'subscribe_channel', text_channel_id: 42 });
    service.disconnect();
  });

  it('keeps application handlers across logout while clearing user channel subscriptions', () => {
    const service = new UnifiedWebSocketService();
    const voiceJoined = vi.fn();
    const messageAck = vi.fn();
    const connectionStates: boolean[] = [];
    service.on('voice_joined', voiceJoined);
    service.on('message_ack', messageAck);
    service.onConnectionStatusChange(({ isConnected }) => connectionStates.push(isConnected));
    service.subscribeChannel(42);

    service.connect('first-token');
    instances[0].open();
    instances[0].receive({ type: 'identified', protocol_version: 1 });
    service.fullDisconnect();

    service.connect('second-token');
    const socket = instances[1];
    socket.open();
    socket.receive({ type: 'identified', protocol_version: 1 });
    socket.receive({ type: 'voice_joined', channel_id: 7, protocol_version: 1 });
    socket.receive({ type: 'message_ack', data: { client_nonce: 'nonce-1' } });

    expect(socket.sent).toEqual([{ type: 'identify', token: 'second-token' }]);
    expect(voiceJoined).toHaveBeenCalledOnce();
    expect(messageAck).toHaveBeenCalledOnce();
    expect(connectionStates.at(-1)).toBe(true);
    service.fullDisconnect();
  });
});
