import { create } from 'zustand'

import { channelApi } from '../services/api'
import { communityApi } from '../services/communityApi'
import type { Message } from '../types'
import type { Thread } from '../types/community'

type MessageUpdate = Message[] | ((messages: Message[]) => Message[])

export interface ThreadHistorySnapshot {
  messages: Message[]
  loaded: boolean
  refreshing: boolean
  revision: number
}

export interface ThreadListSnapshot {
  threads: Thread[]
  loaded: boolean
  refreshing: boolean
}

interface ThreadNavigationState {
  histories: Record<string, ThreadHistorySnapshot>
  lists: Record<string, ThreadListSnapshot>
  refreshHistory: (ownerId: number, threadId: number) => Promise<void>
  refreshList: (ownerId: number, channelId: number) => Promise<void>
  updateMessages: (ownerId: number, threadId: number, update: MessageUpdate) => void
  clearHistory: (ownerId: number, threadId: number) => void
  clear: () => void
}

export const EMPTY_THREAD_HISTORY: ThreadHistorySnapshot = Object.freeze({
  messages: [], loaded: false, refreshing: false, revision: 0,
})
export const EMPTY_THREAD_LIST: ThreadListSnapshot = Object.freeze({
  threads: [], loaded: false, refreshing: false,
})

const historyRequests = new Map<string, Promise<void>>()
const listRequests = new Map<string, Promise<void>>()
const keyOf = (ownerId: number, resourceId: number) => `${ownerId}:${resourceId}`

function reconcileMessages(server: Message[], current: Message[], baseline: Message[]) {
  const baselineById = new Map(baseline.map((message) => [message.id, message]))
  const currentById = new Map(current.map((message) => [message.id, message]))
  const deleted = new Set(baseline.filter((message) => !currentById.has(message.id)).map((message) => message.id))
  const byId = new Map<number, Message>()
  server.filter((message) => !deleted.has(message.id)).forEach((message) => byId.set(message.id, message))
  current.forEach((message) => {
    if (!baselineById.has(message.id) || baselineById.get(message.id) !== message) {
      byId.set(message.id, message)
    }
  })
  return Array.from(byId.values()).sort((left, right) => {
    const time = new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    return time || left.id - right.id
  })
}

export const useThreadNavigationStore = create<ThreadNavigationState>((set, get) => {
  const patchHistory = (
    key: string,
    update: (snapshot: ThreadHistorySnapshot) => ThreadHistorySnapshot,
  ) => set((state) => ({
    histories: {
      ...state.histories,
      [key]: update(state.histories[key] ?? EMPTY_THREAD_HISTORY),
    },
  }))

  return {
    histories: {},
    lists: {},
    refreshHistory: async (ownerId, threadId) => {
      const key = keyOf(ownerId, threadId)
      const pending = historyRequests.get(key)
      if (pending) return pending
      const initial = get().histories[key] ?? EMPTY_THREAD_HISTORY
      const revision = initial.revision
      const baseline = initial.messages
      patchHistory(key, (snapshot) => ({ ...snapshot, refreshing: true }))
      const request = channelApi.getChannelMessages(threadId, 50).then((result) => {
        const serverMessages = Array.isArray(result) ? result : result.messages || []
        patchHistory(key, (snapshot) => ({
          ...snapshot,
          messages: snapshot.revision === revision
            ? serverMessages
            : reconcileMessages(serverMessages, snapshot.messages, baseline),
          loaded: true,
          refreshing: false,
        }))
      }).catch((error) => {
        patchHistory(key, (snapshot) => ({ ...snapshot, loaded: true, refreshing: false }))
        throw error
      }).finally(() => historyRequests.delete(key))
      historyRequests.set(key, request)
      return request
    },
    refreshList: async (ownerId, channelId) => {
      const key = keyOf(ownerId, channelId)
      const pending = listRequests.get(key)
      if (pending) return pending
      set((state) => ({
        lists: {
          ...state.lists,
          [key]: { ...(state.lists[key] ?? EMPTY_THREAD_LIST), refreshing: true },
        },
      }))
      const request = communityApi.listThreads(channelId, true).then((threads) => {
        set((state) => ({
          lists: { ...state.lists, [key]: { threads, loaded: true, refreshing: false } },
        }))
      }).catch((error) => {
        set((state) => ({
          lists: {
            ...state.lists,
            [key]: { ...(state.lists[key] ?? EMPTY_THREAD_LIST), loaded: true, refreshing: false },
          },
        }))
        throw error
      }).finally(() => listRequests.delete(key))
      listRequests.set(key, request)
      return request
    },
    updateMessages: (ownerId, threadId, update) => {
      const key = keyOf(ownerId, threadId)
      patchHistory(key, (snapshot) => ({
        ...snapshot,
        messages: typeof update === 'function' ? update(snapshot.messages) : update,
        revision: snapshot.revision + 1,
      }))
    },
    clearHistory: (ownerId, threadId) => {
      const key = keyOf(ownerId, threadId)
      historyRequests.delete(key)
      set((state) => {
        const histories = { ...state.histories }
        delete histories[key]
        return { histories }
      })
    },
    clear: () => {
      historyRequests.clear()
      listRequests.clear()
      set({ histories: {}, lists: {} })
    },
  }
})

export const threadNavigationKey = keyOf
