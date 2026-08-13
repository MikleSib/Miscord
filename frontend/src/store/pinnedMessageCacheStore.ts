import { create } from 'zustand'

import pinService from '../services/pinService'
import type { Message } from '../types'

export interface PinnedMessageSnapshot {
  messages: Message[]
  canManage: boolean
  limit: number
  loaded: boolean
  refreshing: boolean
  error: string | null
}

interface PinnedMessageCacheState {
  channels: Record<string, PinnedMessageSnapshot>
  refresh: (ownerId: number, channelId: number) => Promise<void>
  clear: () => void
}

export const EMPTY_PINNED_MESSAGES: PinnedMessageSnapshot = Object.freeze({
  messages: [], canManage: false, limit: 50, loaded: false, refreshing: false, error: null,
})

const requests = new Map<string, Promise<void>>()
export const pinnedMessageCacheKey = (ownerId: number, channelId: number) => `${ownerId}:${channelId}`

export const usePinnedMessageCacheStore = create<PinnedMessageCacheState>((set) => ({
  channels: {},
  refresh: async (ownerId, channelId) => {
    const key = pinnedMessageCacheKey(ownerId, channelId)
    const pending = requests.get(key)
    if (pending) return pending
    set((state) => ({
      channels: {
        ...state.channels,
        [key]: { ...(state.channels[key] ?? EMPTY_PINNED_MESSAGES), refreshing: true, error: null },
      },
    }))
    const request = pinService.list(channelId).then((data) => {
      set((state) => ({
        channels: {
          ...state.channels,
          [key]: {
            messages: data.messages,
            canManage: data.can_manage,
            limit: data.limit,
            loaded: true,
            refreshing: false,
            error: null,
          },
        },
      }))
    }).catch((error) => {
      set((state) => ({
        channels: {
          ...state.channels,
          [key]: {
            ...(state.channels[key] ?? EMPTY_PINNED_MESSAGES),
            loaded: true,
            refreshing: false,
            error: 'РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ Р·Р°РєСЂРµРїР»С‘РЅРЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ',
          },
        },
      }))
      throw error
    }).finally(() => requests.delete(key))
    requests.set(key, request)
    return request
  },
  clear: () => {
    requests.clear()
    set({ channels: {} })
  },
}))
