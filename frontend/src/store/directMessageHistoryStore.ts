import { create } from 'zustand'

import directMessageService from '../services/directMessageService'
import type { DirectMessage } from '../types'

type MessageUpdate =
  | DirectMessage[]
  | ((previous: DirectMessage[]) => DirectMessage[])

export interface DirectMessageHistorySnapshot {
  messages: DirectMessage[]
  skip: number
  hasMore: boolean
  loaded: boolean
  loading: boolean
  revision: number
}

interface DirectMessageHistoryState {
  conversations: Record<string, DirectMessageHistorySnapshot>
  refresh: (userId: number, friendId: number) => Promise<void>
  loadOlder: (userId: number, friendId: number) => Promise<void>
  updateMessages: (userId: number, friendId: number, update: MessageUpdate) => void
  clear: () => void
}

export const EMPTY_DM_HISTORY: DirectMessageHistorySnapshot = Object.freeze({
  messages: [],
  skip: 0,
  hasMore: true,
  loaded: false,
  loading: false,
  revision: 0,
})

const requests = new Map<string, Promise<void>>()
const keyOf = (userId: number, friendId: number) => `${userId}:${friendId}`

function getSnapshot(state: DirectMessageHistoryState, key: string) {
  return state.conversations[key] ?? EMPTY_DM_HISTORY
}

function normalize(messages: DirectMessage[]) {
  return messages.map((message) => ({ ...message, reactions: message.reactions ?? [] }))
}

function mergeMessages(older: DirectMessage[], newer: DirectMessage[]) {
  const merged = new Map<string, DirectMessage>()
  for (const message of [...older, ...newer]) {
    const key = message.client_nonce || String(message.id)
    merged.set(key, message)
  }
  return Array.from(merged.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )
}

function reconcileLatest(cached: DirectMessage[], latest: DirectMessage[]) {
  if (latest.length < 30) return latest
  const oldestLatestTime = new Date(latest[0].timestamp).getTime()
  const olderCached = cached.filter(
    (message) => new Date(message.timestamp).getTime() < oldestLatestTime,
  )
  return mergeMessages(olderCached, latest)
}

export const useDirectMessageHistoryStore = create<DirectMessageHistoryState>((set, get) => {
  const patch = (
    key: string,
    update: (snapshot: DirectMessageHistorySnapshot) => DirectMessageHistorySnapshot,
  ) => set((state) => ({
    conversations: { ...state.conversations, [key]: update(getSnapshot(state, key)) },
  }))

  return {
    conversations: {},
    refresh: async (userId, friendId) => {
      const key = keyOf(userId, friendId)
      const pending = requests.get(key)
      if (pending) return pending
      const revision = getSnapshot(get(), key).revision
      patch(key, (snapshot) => ({ ...snapshot, loading: true }))
      const request = directMessageService.getMessages(friendId, 0, 30).then((history) => {
        const normalized = normalize(history)
        patch(key, (snapshot) => {
          if (snapshot.revision !== revision) {
            return { ...snapshot, loaded: true, loading: false }
          }
          const messages = snapshot.loaded
            ? reconcileLatest(snapshot.messages, normalized)
            : normalized
          return {
            ...snapshot,
            messages,
            skip: messages.length,
            hasMore: snapshot.loaded ? snapshot.hasMore : normalized.length === 30,
            loaded: true,
            loading: false,
          }
        })
      }).catch((error) => {
        patch(key, (snapshot) => ({ ...snapshot, loaded: true, loading: false }))
        throw error
      }).finally(() => {
        requests.delete(key)
      })
      requests.set(key, request)
      return request
    },
    loadOlder: async (userId, friendId) => {
      const key = keyOf(userId, friendId)
      const snapshot = getSnapshot(get(), key)
      if (snapshot.loading || !snapshot.hasMore) return
      patch(key, (current) => ({ ...current, loading: true }))
      try {
        const history = normalize(await directMessageService.getMessages(friendId, snapshot.skip, 30))
        patch(key, (current) => {
          const messages = mergeMessages(history, current.messages)
          return {
            ...current,
            messages,
            skip: messages.length,
            hasMore: history.length === 30,
            loaded: true,
            loading: false,
          }
        })
      } catch (error) {
        patch(key, (current) => ({ ...current, loading: false }))
        throw error
      }
    },
    updateMessages: (userId, friendId, update) => {
      const key = keyOf(userId, friendId)
      patch(key, (snapshot) => {
        const messages = typeof update === 'function' ? update(snapshot.messages) : update
        return {
          ...snapshot,
          messages,
          skip: snapshot.loaded ? messages.length : snapshot.skip,
          revision: snapshot.revision + 1,
        }
      })
    },
    clear: () => {
      requests.clear()
      set({ conversations: {} })
    },
  }
})
