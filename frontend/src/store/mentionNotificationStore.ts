import { create } from 'zustand'
import soundService from '../services/soundService'
import websocketService from '../services/websocketService'
import { useAuthStore } from './store'
import {
  shouldNotifyMentionClient,
  useNotificationSettingsStore,
} from './notificationSettingsStore'

export type PendingMention = {
  messageId: number
  textChannelId: number
  serverId: number
  channelName?: string
  createdAt: number
}

type MentionPayload = {
  data?: {
    message_id?: number
    text_channel_id?: number
    server_id?: number
    channel_name?: string
    author?: {
      id?: number
      username?: string
      display_name?: string | null
    }
    mentioned_user_id?: number
  }
}

interface MentionNotificationState {
  /** Непрочитанные пинги (от старых к новым). */
  pending: PendingMention[]
  addMention: (
    mention: Omit<PendingMention, 'createdAt'> & { createdAt?: number },
    options?: { playSound?: boolean }
  ) => void
  markMessageRead: (messageId: number) => void
  markChannelRead: (textChannelId: number) => void
  clearAll: () => void
}

export const useMentionNotificationStore = create<MentionNotificationState>((set, get) => ({
  pending: [],

  addMention: (mention, options = {}) => {
    const playSound = options.playSound !== false
    const exists = get().pending.some((item) => item.messageId === mention.messageId)
    if (exists) return

    set((state) => ({
      pending: [
        ...state.pending,
        {
          messageId: mention.messageId,
          textChannelId: mention.textChannelId,
          serverId: mention.serverId,
          channelName: mention.channelName,
          createdAt: mention.createdAt ?? Date.now(),
        },
      ],
    }))

    if (playSound) {
      soundService.playDmNotificationSound()
    }
  },

  markMessageRead: (messageId) => {
    set((state) => ({
      pending: state.pending.filter((item) => item.messageId !== messageId),
    }))
  },

  markChannelRead: (textChannelId) => {
    set((state) => ({
      pending: state.pending.filter((item) => item.textChannelId !== textChannelId),
    }))
  },

  clearAll: () => set({ pending: [] }),
}))

export function selectServerMentionCount(serverId: number): (state: MentionNotificationState) => number {
  return (state) => state.pending.filter((item) => item.serverId === serverId).length
}

export function selectChannelMentionCount(
  textChannelId: number
): (state: MentionNotificationState) => number {
  return (state) => state.pending.filter((item) => item.textChannelId === textChannelId).length
}

export function selectChannelMentions(
  textChannelId: number
): (state: MentionNotificationState) => PendingMention[] {
  return (state) =>
    state.pending
      .filter((item) => item.textChannelId === textChannelId)
      .sort((a, b) => a.createdAt - b.createdAt || a.messageId - b.messageId)
}

let mentionListenerRegistered = false

/** Глобальный слушатель пингов (даже если открыт другой канал/сервер). */
export function registerMentionNotificationListener(): void {
  if (mentionListenerRegistered || typeof window === 'undefined') return
  mentionListenerRegistered = true

  websocketService.on('mention', (payload: MentionPayload) => {
    const data = payload?.data
    if (!data?.message_id || !data?.text_channel_id || !data?.server_id) return

    const currentUserId = useAuthStore.getState().user?.id
    if (!currentUserId) return
    if (data.mentioned_user_id && data.mentioned_user_id !== currentUserId) return
    if (data.author?.id === currentUserId) return

    const settings = useNotificationSettingsStore.getState().get(data.server_id)
    if (!shouldNotifyMentionClient(settings, data.text_channel_id)) {
      return
    }

    useMentionNotificationStore.getState().addMention({
      messageId: data.message_id,
      textChannelId: data.text_channel_id,
      serverId: data.server_id,
      channelName: data.channel_name,
    })
  })
}

export function formatMentionBadge(count: number): string {
  return count > 99 ? '99+' : String(count)
}
