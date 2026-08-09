import { describe, expect, it } from 'vitest';

import { BotVoiceGateway } from './voiceGateway.js';


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
