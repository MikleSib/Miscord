import { create } from 'zustand'

import serverService from '../services/serverService'
import {
  ChannelNotificationLevel,
  ServerNotificationLevel,
  ServerNotificationSettings,
} from '../types'

const DEFAULTS: Omit<ServerNotificationSettings, 'server_id'> = {
  muted: false,
  notification_level: 'all',
  suppress_everyone: false,
  suppress_roles: false,
  suppress_highlights: false,
  mute_events: false,
  mobile_push: true,
  channel_overrides: [],
}

interface NotificationSettingsState {
  byServer: Record<number, ServerNotificationSettings>
  pending: Record<number, boolean>
  load: (serverId: number, options?: { force?: boolean }) => Promise<ServerNotificationSettings>
  setLocal: (serverId: number, settings: ServerNotificationSettings) => void
  get: (serverId: number) => ServerNotificationSettings
}

export const useNotificationSettingsStore = create<NotificationSettingsState>((set, get) => ({
  byServer: {},
  pending: {},

  load: async (serverId, options = {}) => {
    if (!serverId) {
      return { server_id: 0, ...DEFAULTS }
    }
    if (get().pending[serverId]) {
      return get().byServer[serverId] ?? { server_id: serverId, ...DEFAULTS }
    }
    if (get().byServer[serverId] && !options.force) {
      return get().byServer[serverId]
    }

    set((state) => ({ pending: { ...state.pending, [serverId]: true } }))
    try {
      const settings = await serverService.getNotificationSettings(serverId)
      set((state) => ({
        byServer: { ...state.byServer, [serverId]: settings },
      }))
      return settings
    } catch (error) {
      console.warn('[NotificationSettings] Не удалось загрузить', serverId, error)
      const fallback = { server_id: serverId, ...DEFAULTS }
      set((state) => ({
        byServer: { ...state.byServer, [serverId]: fallback },
      }))
      return fallback
    } finally {
      set((state) => {
        const nextPending = { ...state.pending }
        delete nextPending[serverId]
        return { pending: nextPending }
      })
    }
  },

  setLocal: (serverId, settings) => {
    set((state) => ({
      byServer: { ...state.byServer, [serverId]: settings },
    }))
  },

  get: (serverId) => get().byServer[serverId] ?? { server_id: serverId, ...DEFAULTS },
}))

export function effectiveChannelLevel(
  settings: ServerNotificationSettings,
  textChannelId: number
): ChannelNotificationLevel | ServerNotificationLevel {
  const override = settings.channel_overrides.find(
    (item) => item.text_channel_id === textChannelId
  )
  if (override) return override.level
  if (settings.muted) return 'mentions'
  return settings.notification_level
}

export function shouldNotifyMentionClient(
  settings: ServerNotificationSettings,
  textChannelId: number
): boolean {
  const level = effectiveChannelLevel(settings, textChannelId)
  return level !== 'nothing' && level !== 'muted'
}
