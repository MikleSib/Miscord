import { create } from 'zustand'

import type { DecryptedSecretMessage } from '../services/e2ee/secretDmCrypto'

export type DisplaySecretMessage = DecryptedSecretMessage & { pending?: boolean }

interface SecretHistoryResult {
  messages: DisplaySecretMessage[]
  peerReady: boolean
}

export interface SecretDmHistorySnapshot {
  messages: DisplaySecretMessage[]
  peerReady: boolean | null
  loaded: boolean
  refreshing: boolean
  revision: number
}

interface SecretDmHistoryState {
  conversations: Record<string, SecretDmHistorySnapshot>
  refresh: (
    ownerId: number,
    peerId: number,
    loader: () => Promise<SecretHistoryResult>,
  ) => Promise<void>
  updateMessages: (
    ownerId: number,
    peerId: number,
    update: (messages: DisplaySecretMessage[]) => DisplaySecretMessage[],
  ) => void
  setPeerReady: (ownerId: number, peerId: number, ready: boolean) => void
  reset: (ownerId: number, peerId: number) => void
  clear: () => void
}

export const EMPTY_SECRET_DM_HISTORY: SecretDmHistorySnapshot = Object.freeze({
  messages: [], peerReady: null, loaded: false, refreshing: false, revision: 0,
})

const requests = new Map<string, Promise<void>>()
export const secretDmHistoryKey = (ownerId: number, peerId: number) => `${ownerId}:${peerId}`

function mergeMessages(server: DisplaySecretMessage[], current: DisplaySecretMessage[]) {
  const byKey = new Map<string, DisplaySecretMessage>()
  server.forEach((message) => byKey.set(message.client_nonce || String(message.id), message))
  current.forEach((message) => {
    const key = message.client_nonce || String(message.id)
    if (message.pending || !byKey.has(key)) byKey.set(key, message)
  })
  return Array.from(byKey.values()).sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  )
}

export const useSecretDmHistoryStore = create<SecretDmHistoryState>((set, get) => {
  const patch = (
    key: string,
    update: (snapshot: SecretDmHistorySnapshot) => SecretDmHistorySnapshot,
  ) => set((state) => ({
    conversations: {
      ...state.conversations,
      [key]: update(state.conversations[key] ?? EMPTY_SECRET_DM_HISTORY),
    },
  }))

  return {
    conversations: {},
    refresh: async (ownerId, peerId, loader) => {
      const key = secretDmHistoryKey(ownerId, peerId)
      const pending = requests.get(key)
      if (pending) return pending
      const revision = (get().conversations[key] ?? EMPTY_SECRET_DM_HISTORY).revision
      patch(key, (snapshot) => ({ ...snapshot, refreshing: true }))
      const request = loader().then((result) => {
        patch(key, (snapshot) => ({
          ...snapshot,
          messages: snapshot.revision === revision
            ? result.messages
            : mergeMessages(result.messages, snapshot.messages),
          peerReady: result.peerReady,
          loaded: true,
          refreshing: false,
        }))
      }).catch((error) => {
        patch(key, (snapshot) => ({ ...snapshot, loaded: true, refreshing: false }))
        throw error
      }).finally(() => requests.delete(key))
      requests.set(key, request)
      return request
    },
    updateMessages: (ownerId, peerId, update) => {
      const key = secretDmHistoryKey(ownerId, peerId)
      patch(key, (snapshot) => ({
        ...snapshot,
        messages: update(snapshot.messages),
        revision: snapshot.revision + 1,
      }))
    },
    setPeerReady: (ownerId, peerId, peerReady) => {
      patch(secretDmHistoryKey(ownerId, peerId), (snapshot) => ({ ...snapshot, peerReady }))
    },
    reset: (ownerId, peerId) => {
      const key = secretDmHistoryKey(ownerId, peerId)
      requests.delete(key)
      patch(key, (snapshot) => ({
        ...snapshot,
        messages: [],
        loaded: true,
        refreshing: false,
        revision: snapshot.revision + 1,
      }))
    },
    clear: () => {
      requests.clear()
      set({ conversations: {} })
    },
  }
})
