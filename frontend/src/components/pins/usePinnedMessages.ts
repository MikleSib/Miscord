'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import pinService from '../../services/pinService'
import unifiedWebSocketService from '../../services/unifiedWebSocketService'
import { GatewayEvents } from '../../lib/gatewayEvents'
import type { Message } from '../../types'

interface PinsState {
  messages: Message[]
  canManage: boolean
  limit: number
}

const EMPTY: PinsState = { messages: [], canManage: false, limit: 50 }

export function usePinnedMessages(textChannelId: number | null) {
  const [state, setState] = useState<PinsState>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (textChannelId == null) {
      setState(EMPTY)
      return
    }
    try {
      const data = await pinService.list(textChannelId)
      setState({ messages: data.messages, canManage: data.can_manage, limit: data.limit })
      setError(null)
    } catch {
      setError('Не удалось загрузить закреплённые сообщения')
    }
  }, [textChannelId])

  useEffect(() => {
    setState(EMPTY)
    setError(null)
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
        setError(typeof detail === 'string' ? detail : 'Не удалось изменить закрепление')
      }
    },
    [reload, textChannelId],
  )

  return {
    pinnedMessages: state.messages,
    pinnedIds,
    canManagePins: state.canManage,
    pinLimit: state.limit,
    pinsError: error,
    reloadPins: reload,
    setPinned,
  }
}
