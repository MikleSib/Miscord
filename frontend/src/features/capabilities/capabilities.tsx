'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';

export interface ProductCapabilities {
  version: number;
  threads: boolean;
  forums: boolean;
  polls: boolean;
  inbox: boolean;
  serverTemplates: boolean;
  serverImports: boolean;
  webhooks: boolean;
  webhookFiles: boolean;
  botPlatform: boolean;
  emailVerification: boolean;
  voice: boolean;
  screenShare: boolean;
  customEmoji: boolean;
  stickers: boolean;
  gifs: boolean;
  soundboard: boolean;
  stageChannels: boolean;
}

interface CapabilitiesContextValue extends ProductCapabilities {
  ready: boolean;
}

export const CONSERVATIVE_CAPABILITIES: ProductCapabilities = {
  version: 1,
  threads: false,
  forums: false,
  polls: false,
  inbox: false,
  serverTemplates: false,
  serverImports: false,
  webhooks: false,
  webhookFiles: false,
  botPlatform: false,
  emailVerification: false,
  voice: true,
  screenShare: true,
  customEmoji: false,
  stickers: false,
  gifs: false,
  soundboard: false,
  stageChannels: false,
};

type CapabilityResponse = Record<string, unknown>;

export function normalizeCapabilities(payload: CapabilityResponse): ProductCapabilities {
  const enabled = (key: string, fallback = false) =>
    typeof payload[key] === 'boolean' ? payload[key] as boolean : fallback;

  return {
    version: typeof payload.version === 'number' ? payload.version : 1,
    threads: enabled('threads'),
    forums: enabled('forums'),
    polls: enabled('polls'),
    inbox: enabled('inbox'),
    serverTemplates: enabled('server_templates'),
    serverImports: enabled('server_imports'),
    webhooks: enabled('webhooks'),
    webhookFiles: enabled('webhook_files'),
    botPlatform: enabled('bot_platform'),
    emailVerification: enabled('email_verification'),
    voice: enabled('voice', true),
    screenShare: enabled('screen_share', true),
    customEmoji: enabled('custom_emoji'),
    stickers: enabled('stickers'),
    gifs: enabled('gifs'),
    soundboard: enabled('soundboard'),
    stageChannels: enabled('stage_channels'),
  };
}

const CapabilitiesContext = createContext<CapabilitiesContextValue>({
  ...CONSERVATIVE_CAPABILITIES,
  ready: false,
});

export function CapabilitiesProvider({ children }: { children: React.ReactNode }) {
  const [capabilities, setCapabilities] = useState(CONSERVATIVE_CAPABILITIES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    api.get<CapabilityResponse>('/api/v1/capabilities', { timeout: 5_000 })
      .then((response) => {
        if (active) setCapabilities(normalizeCapabilities(response.data));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(() => ({ ...capabilities, ready }), [capabilities, ready]);
  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities(): CapabilitiesContextValue {
  return useContext(CapabilitiesContext);
}
