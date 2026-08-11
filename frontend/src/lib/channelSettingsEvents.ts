import type { Channel } from '../types'

const OPEN_CHANNEL_SETTINGS_EVENT = 'miscord:open-channel-settings'

interface OpenChannelSettingsDetail {
  channelId: number
  channelType: Channel['type']
}

export function requestChannelSettings(channel: Pick<Channel, 'id' | 'type'>): void {
  if (typeof window === 'undefined') return

  window.dispatchEvent(new CustomEvent<OpenChannelSettingsDetail>(OPEN_CHANNEL_SETTINGS_EVENT, {
    detail: {
      channelId: channel.id,
      channelType: channel.type,
    },
  }))
}

export function subscribeToChannelSettingsRequests(
  listener: (detail: OpenChannelSettingsDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined

  const handleRequest = (event: Event) => {
    listener((event as CustomEvent<OpenChannelSettingsDetail>).detail)
  }

  window.addEventListener(OPEN_CHANNEL_SETTINGS_EVENT, handleRequest)
  return () => window.removeEventListener(OPEN_CHANNEL_SETTINGS_EVENT, handleRequest)
}
