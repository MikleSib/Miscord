'use client'

import { useCallback, useEffect } from 'react'

import {
  EMPTY_HOME_NAVIGATION,
  useHomeNavigationStore,
} from '../store/homeNavigationStore'
import type { User } from '../types'

type Update<T> = T | ((previous: T) => T)

export function useHomeNavigationData(userId?: number) {
  const snapshot = useHomeNavigationStore(
    (state) => (userId == null ? undefined : state.snapshots[userId]),
  ) ?? EMPTY_HOME_NAVIGATION
  const refresh = useHomeNavigationStore((state) => state.refresh)
  const updateFriends = useHomeNavigationStore((state) => state.setFriends)
  const updateConversations = useHomeNavigationStore((state) => state.setDmConversations)
  const updatePending = useHomeNavigationStore((state) => state.setPendingRequests)
  const updateSelected = useHomeNavigationStore((state) => state.setSelectedFriend)

  useEffect(() => {
    if (userId == null) return
    void refresh(userId).catch((error) => {
      console.error('Не удалось обновить список друзей и диалогов:', error)
    })
  }, [refresh, userId])

  const setFriends = useCallback((update: Update<User[]>) => {
    if (userId != null) updateFriends(userId, update)
  }, [updateFriends, userId])
  const setDmConversations = useCallback((update: Update<User[]>) => {
    if (userId != null) updateConversations(userId, update)
  }, [updateConversations, userId])
  const setPendingRequests = useCallback((update: Update<any[]>) => {
    if (userId != null) updatePending(userId, update)
  }, [updatePending, userId])
  const setSelectedFriend = useCallback((update: Update<User | null>) => {
    if (userId != null) updateSelected(userId, update)
  }, [updateSelected, userId])

  return {
    ...snapshot,
    setFriends,
    setDmConversations,
    setPendingRequests,
    setSelectedFriend,
  }
}
