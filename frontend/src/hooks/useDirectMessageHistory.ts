'use client'

import { useCallback, useEffect } from 'react'

import {
  EMPTY_DM_HISTORY,
  useDirectMessageHistoryStore,
} from '../store/directMessageHistoryStore'
import type { DirectMessage } from '../types'

type MessageUpdate =
  | DirectMessage[]
  | ((previous: DirectMessage[]) => DirectMessage[])

export function useDirectMessageHistory(userId: number | undefined, friendId: number) {
  const key = userId == null ? null : `${userId}:${friendId}`
  const snapshot = useDirectMessageHistoryStore(
    (state) => (key == null ? undefined : state.conversations[key]),
  ) ?? EMPTY_DM_HISTORY
  const refresh = useDirectMessageHistoryStore((state) => state.refresh)
  const loadOlder = useDirectMessageHistoryStore((state) => state.loadOlder)
  const update = useDirectMessageHistoryStore((state) => state.updateMessages)

  useEffect(() => {
    if (userId == null) return
    void refresh(userId, friendId).catch((error) => {
      console.error('Не удалось обновить историю личных сообщений:', error)
    })
  }, [friendId, refresh, userId])

  const setMessages = useCallback((next: MessageUpdate) => {
    if (userId != null) update(userId, friendId, next)
  }, [friendId, update, userId])

  const loadMore = useCallback(() => {
    if (userId == null) return Promise.resolve()
    return loadOlder(userId, friendId)
  }, [friendId, loadOlder, userId])

  return { ...snapshot, setMessages, loadMore }
}
