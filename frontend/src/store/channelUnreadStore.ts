import { create } from 'zustand'

import soundService from '../services/soundService'
import websocketService from '../services/websocketService'
import { useAuthStore } from './store'

export type PendingChannelUnread = {
  messageId: number
  textChannelId: number
  serverId: number
  channelName?: string
  createdAt: number
}

type ChannelMessagePayload = {
  data?: {
    message_id?: number
    text_channel_id?: number
    server_id?: number
    channel_name?: string
    author?: { id?: number }
  }
}

interface ChannelUnreadState {
  pending: PendingChannelUnread[]
  /** Канал, который пользователь сейчас смотрит (чтобы не дублировать уведомление). */
  viewingTextChannelId: number | null
  setViewingTextChannelId: (textChannelId: number | null) => void
  addUnread: (
    item: Omit<PendingChannelUnread, 'createdAt'> & { createdAt?: number },
    options?: { playSound?: boolean }
  ) => void
  markChannelRead: (textChannelId: number) => void
  clearAll: () => void
}

export const useChannelUnreadStore = create<ChannelUnreadState>((set, get) => ({
  pending: [],
  viewingTextChannelId: null,

  setViewingTextChannelId: (textChannelId) => {
    set({ viewingTextChannelId: textChannelId })
  },

  addUnread: (item, options = {}) => {
    const playSound = options.playSound !== false
    if (get().pending.some((entry) => entry.messageId === item.messageId)) return

    set((state) => ({
      pending: [
        ...state.pending,
        {
          messageId: item.messageId,
          textChannelId: item.textChannelId,
          serverId: item.serverId,
          channelName: item.channelName,
          createdAt: item.createdAt ?? Date.now(),
        },
      ],
    }))

    if (playSound) {
      soundService.playDmNotificationSound()
    }
  },

  markChannelRead: (textChannelId) => {
    set((state) => ({
      pending: state.pending.filter((item) => item.textChannelId !== textChannelId),
    }))
  },

  clearAll: () => set({ pending: [] }),
}))

export function selectChannelHasUnread(
  textChannelId: number
): (state: ChannelUnreadState) => boolean {
  return (state) => state.pending.some((item) => item.textChannelId === textChannelId)
}

export function selectServerHasUnread(
  serverId: number
): (state: ChannelUnreadState) => boolean {
  return (state) => state.pending.some((item) => item.serverId === serverId)
}

let listenerRegistered = false

/** Слушатель «обычных» сообщений для режима «Все сообщения». */
export function registerChannelUnreadListener(): void {
  if (listenerRegistered || typeof window === 'undefined') return
  listenerRegistered = true

  websocketService.on('channel_message', (payload: ChannelMessagePayload) => {
    const data = payload?.data
    if (!data?.message_id || !data?.text_channel_id || !data?.server_id) return

    const currentUserId = useAuthStore.getState().user?.id
    if (!currentUserId) return
    if (data.author?.id === currentUserId) return

    // Уже смотрим этот канал — сообщение видно в чате, уведомление не нужно
    if (useChannelUnreadStore.getState().viewingTextChannelId === data.text_channel_id) {
      return
    }

    useChannelUnreadStore.getState().addUnread({
      messageId: data.message_id,
      textChannelId: data.text_channel_id,
      serverId: data.server_id,
      channelName: data.channel_name,
    })
  })
}
