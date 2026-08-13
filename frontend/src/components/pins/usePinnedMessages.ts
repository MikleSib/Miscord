'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import pinService from '../../services/pinService'
import unifiedWebSocketService from '../../services/unifiedWebSocketService'
import { GatewayEvents } from '../../lib/gatewayEvents'
import { useAuthStore } from '../../store/store'
import {
  EMPTY_PINNED_MESSAGES,
  pinnedMessageCacheKey,
  usePinnedMessageCacheStore,
} from '../../store/pinnedMessageCacheStore'

export function usePinnedMessages(textChannelId: number | null) {
  const ownerId = useAuthStore((state) => state.user?.id)
  const key = ownerId && textChannelId != null
    ? pinnedMessageCacheKey(ownerId, textChannelId)
    : ''
  const state = usePinnedMessageCacheStore((cache) => (
    key ? cache.channels[key] ?? EMPTY_PINNED_MESSAGES : EMPTY_PINNED_MESSAGES
  ))
  const refresh = usePinnedMessageCacheStore((cache) => cache.refresh)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (textChannelId == null || !ownerId) return
    setMutationError(null)
    await refresh(ownerId, textChannelId).catch(() => undefined)
  }, [ownerId, refresh, textChannelId])

  useEffect(() => {
    setMutationError(null)
    void reload()
  }, [reload])

  useEffect(() => {
    if (textChannelId == null) return

    const handler = (payload: { data?: { text_channel_id?: number } }) => {
      if (payload?.data?.text_channel_id !== textChannelId) return
      void reload()
    }

    unifiedWebSocketService.on(GatewayEvents.CHANNEL_PINS_UPDATED, handler)
    return () => {
      unifiedWebSocketService.off(GatewayEvents.CHANNEL_PINS_UPDATED, handler)
    }
  }, [textChannelId, reload])

  const pinnedIds = useMemo(
    () => new Set(state.messages.map((message) => message.id)),
    [state.messages],
  )

  const setPinned = useCallback(
    async (messageId: number, pinned: boolean) => {
      if (textChannelId == null) return
      try {
        if (pinned) {
          await pinService.pin(textChannelId, messageId)
        } else {
          await pinService.unpin(textChannelId, messageId)
        }
        await reload()
      } catch (requestError) {
        const detail = (requestError as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail
        setMutationError(typeof detail === 'string' ? detail : 'Не удалось изменить закрепление')
      }
    },
    [reload, textChannelId],
  )

  return {
    pinnedMessages: state.messages,
    pinnedIds,
    canManagePins: state.canManage,
    pinLimit: state.limit,
    pinsError: mutationError ?? state.error,
    reloadPins: reload,
    setPinned,
  }
}
