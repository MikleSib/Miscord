import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  connectIdentify: undefined as Record<string, unknown> | undefined,
  e2eeCalls: [] as Array<{ type: string; value?: unknown }>,
  producedTrack: undefined as MediaStreamTrack | undefined,
  enabledAtProduce: undefined as boolean | undefined,
}));

class FakeProducer {
  readonly id = 'microphone-producer';
  readonly rtpSender = {} as RTCRtpSender;
  pause(): void {}
  resume(): void {}
  close(): void {}
}

class FakeTransport {
  readonly id: string;
  constructor(direction: string) { this.id = `${direction}-transport`; }
  on(): void {}
  close(): void {}
  async produce(options: Record<string, unknown>): Promise<FakeProducer> {
    state.producedTrack = options.track as MediaStreamTrack;
    state.enabledAtProduce = state.producedTrack.enabled;
    return new FakeProducer();
  }
}

vi.mock('mediasoup-client', () => ({
  Device: class {
    readonly rtpCapabilities = {};
    async load(): Promise<void> {}
    createSendTransport(): FakeTransport { return new FakeTransport('send'); }
    createRecvTransport(): FakeTransport { return new FakeTransport('recv'); }
  },
}));

vi.mock('../mediaRpcClient', () => ({
  MediaRpcClient: class {
    async connect(_url: string, _ticket: string, identify?: Record<string, unknown>) {
      state.connectIdentify = identify;
      return { router_rtp_capabilities: {}, producers: [], e2ee: { action: 'create' } };
    }
    async request(type: string, payload: Record<string, unknown>) {
      if (type === 'create_transport') return {
        transport_id: `${payload.direction}-transport`, ice_parameters: {},
        ice_candidates: [], dtls_parameters: {},
      };
      return {};
    }
    on(): void {}
    close(): void {}
  },
}));

vi.mock('../e2ee/voiceE2EE', () => ({
  VoiceE2EE: class {
    constructor(_rpc: unknown, credentialId: string) {
      state.e2eeCalls.push({ type: 'constructor', value: credentialId });
    }
    onFailure(): void {}
    onEpochActive(): void {}
    async hello() {
      state.e2eeCalls.push({ type: 'hello' });
      return { protocol_version: 1, credential_id: '77:session' };
    }
    async activate(value: unknown): Promise<void> { state.e2eeCalls.push({ type: 'activate', value }); }
    protectSender(_sender: unknown, source: string): void {
      state.e2eeCalls.push({ type: 'protect-sender', value: source });
    }
    close(): void {}
  },
}));

import { SfuTransport } from '../sfuTransport';

function microphoneTrack(): MediaStreamTrack {
  const value = {
    kind: 'audio', enabled: true, stop: vi.fn(),
    clone: vi.fn(() => microphoneTrack()),
  } as unknown as MediaStreamTrack;
  return value;
}

beforeEach(() => {
  state.connectIdentify = undefined;
  state.e2eeCalls.length = 0;
  state.producedTrack = undefined;
  state.enabledAtProduce = undefined;
});

describe('SfuTransport E2EE startup', () => {
  it('installs MLS and the sender transform before opening the microphone track', async () => {
    const transport = new SfuTransport();
    await transport.connect(
      'ws://local/ws/media', 'ticket', microphoneTrack(), false,
      { userId: 77, sessionId: 'session' },
    );

    expect(state.connectIdentify).toEqual({
      e2ee: { protocol_version: 1, credential_id: '77:session' },
    });
    expect(state.e2eeCalls.map(({ type }) => type)).toEqual([
      'constructor', 'hello', 'activate', 'protect-sender',
    ]);
    expect(state.enabledAtProduce).toBe(false);
    expect(state.producedTrack?.enabled).toBe(true);
    transport.close();
  });
});
