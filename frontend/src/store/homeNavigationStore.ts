import { create } from 'zustand'

import type { User } from '../types'
import directMessageService from '../services/directMessageService'
import friendService from '../services/friendService'

type Update<T> = T | ((previous: T) => T)

export interface HomeNavigationSnapshot {
  friends: User[]
  dmConversations: User[]
  pendingRequests: any[]
  selectedFriend: User | null
  loaded: boolean
  refreshing: boolean
  revision: number
}

interface HomeNavigationState {
  snapshots: Record<number, HomeNavigationSnapshot>
  refresh: (userId: number) => Promise<void>
  setFriends: (userId: number, update: Update<User[]>) => void
  setDmConversations: (userId: number, update: Update<User[]>) => void
  setPendingRequests: (userId: number, update: Update<any[]>) => void
  setSelectedFriend: (userId: number, update: Update<User | null>) => void
  clear: () => void
}

export const EMPTY_HOME_NAVIGATION: HomeNavigationSnapshot = Object.freeze({
  friends: [],
  dmConversations: [],
  pendingRequests: [],
  selectedFriend: null,
  loaded: false,
  refreshing: false,
  revision: 0,
})

const refreshes = new Map<number, Promise<void>>()

function currentSnapshot(state: HomeNavigationState, userId: number) {
  return state.snapshots[userId] ?? EMPTY_HOME_NAVIGATION
}

function updateSnapshot(
  set: (updater: (state: HomeNavigationState) => Partial<HomeNavigationState>) => void,
  userId: number,
  update: (snapshot: HomeNavigationSnapshot) => HomeNavigationSnapshot,
) {
  set((state) => ({
    snapshots: { ...state.snapshots, [userId]: update(currentSnapshot(state, userId)) },
  }))
}

export const useHomeNavigationStore = create<HomeNavigationState>((set, get) => ({
  snapshots: {},
  refresh: async (userId) => {
    const pending = refreshes.get(userId)
    if (pending) return pending

    const revision = currentSnapshot(get(), userId).revision
    updateSnapshot(set, userId, (snapshot) => ({ ...snapshot, refreshing: true }))
    const request = Promise.all([
      friendService.getFriends(),
      friendService.getPendingRequests(),
      directMessageService.getConversations(),
    ]).then(([friends, pendingRequests, dmConversations]) => {
      updateSnapshot(set, userId, (snapshot) => {
        if (snapshot.revision !== revision) {
          return { ...snapshot, loaded: true, refreshing: false }
        }
        return {
          ...snapshot,
          friends,
          pendingRequests,
          dmConversations,
          selectedFriend: snapshot.selectedFriend
            ? [...friends, ...dmConversations].find(
                (candidate) => candidate.id === snapshot.selectedFriend?.id,
              ) ?? snapshot.selectedFriend
            : null,
          loaded: true,
          refreshing: false,
        }
      })
    }).catch((error) => {
      updateSnapshot(set, userId, (snapshot) => ({ ...snapshot, refreshing: false }))
      throw error
    }).finally(() => {
      refreshes.delete(userId)
    })

    refreshes.set(userId, request)
    return request
  },
  setFriends: (userId, update) => updateSnapshot(set, userId, (snapshot) => ({
    ...snapshot,
    friends: typeof update === 'function' ? update(snapshot.friends) : update,
    revision: snapshot.revision + 1,
  })),
  setDmConversations: (userId, update) => updateSnapshot(set, userId, (snapshot) => ({
    ...snapshot,
    dmConversations: typeof update === 'function' ? update(snapshot.dmConversations) : update,
    revision: snapshot.revision + 1,
  })),
  setPendingRequests: (userId, update) => updateSnapshot(set, userId, (snapshot) => ({
    ...snapshot,
    pendingRequests: typeof update === 'function' ? update(snapshot.pendingRequests) : update,
    revision: snapshot.revision + 1,
  })),
  setSelectedFriend: (userId, update) => updateSnapshot(set, userId, (snapshot) => ({
    ...snapshot,
    selectedFriend: typeof update === 'function' ? update(snapshot.selectedFriend) : update,
  })),
  clear: () => {
    refreshes.clear()
    set({ snapshots: {} })
  },
}))
