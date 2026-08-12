import { describe, expect, it } from 'vitest';
import { normalizeCapabilities } from './capabilities';

describe('normalizeCapabilities', () => {
  it('maps server snake_case flags and keeps unknown features disabled', () => {
    const result = normalizeCapabilities({
      version: 1,
      threads: true,
      server_templates: true,
      bot_platform: false,
      voice: true,
      screen_share: true,
    });

    expect(result.threads).toBe(true);
    expect(result.serverTemplates).toBe(true);
    expect(result.botPlatform).toBe(false);
    expect(result.polls).toBe(false);
    expect(result.voice).toBe(true);
  });
});
