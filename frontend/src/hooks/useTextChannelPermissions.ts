'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { hasPermission, Permissions } from '../lib/permissions'
import channelService from '../services/channelService'
import websocketService from '../services/websocketService'

export type TextChannelPermissionStatus = 'loading' | 'ready' | 'denied' | 'error'

interface PermissionSnapshot {
  channelId: number | null
  permissions: number | null
  status: TextChannelPermissionStatus
}

function eventData(payload: any): any {
  return payload?.data ?? payload ?? {}
}

export function useTextChannelPermissions(
  textChannelId: number | null,
  serverId: number | null,
) {
  const requestId = useRef(0)
  const [snapshot, setSnapshot] = useState<PermissionSnapshot>({
    channelId: null,
    permissions: null,
    status: 'loading',
  })

  const load = useCallback(async (background = false) => {
    if (!textChannelId) return
    const currentRequest = ++requestId.current
    if (!background) {
      setSnapshot({ channelId: textChannelId, permissions: null, status: 'loading' })
    }

    try {
      const permissions = await channelService.getMyTextChannelPermissions(textChannelId)
      if (currentRequest !== requestId.current) return
      setSnapshot({ channelId: textChannelId, permissions, status: 'ready' })
    } catch (error) {
      if (currentRequest !== requestId.current) return
      const responseStatus = (error as { response?: { status?: number } }).response?.status
      setSnapshot((current) => {
        if (background && current.channelId === textChannelId && current.status === 'ready') {
          return current
        }
        return {
          channelId: textChannelId,
          permissions: null,
          status: responseStatus === 403 || responseStatus === 404 ? 'denied' : 'error',
        }
      })
    }
  }, [textChannelId])

  useEffect(() => {
    if (!textChannelId) {
      requestId.current += 1
      setSnapshot({ channelId: null, permissions: null, status: 'loading' })
      return
    }
    void load(false)
    return () => { requestId.current += 1 }
  }, [load, textChannelId])

  useEffect(() => {
    if (!textChannelId || !serverId) return

    const onChannelPermissions = (payload: any) => {
      const data = eventData(payload)
      if (Number(data.text_channel_id) === textChannelId) void load(true)
    }
    const onServerPermissions = (payload: any) => {
      const data = eventData(payload)
      if (Number(data.server_id) === serverId) void load(true)
    }
    const serverEvents = [
      'server_role_created',
      'server_role_updated',
      'server_role_deleted',
      'server_member_roles_updated',
      'server_ownership_transferred',
    ]

    websocketService.on('channel_permissions_updated', onChannelPermissions)
    serverEvents.forEach((event) => websocketService.on(event, onServerPermissions))
    return () => {
      websocketService.off('channel_permissions_updated', onChannelPermissions)
      serverEvents.forEach((event) => websocketService.off(event, onServerPermissions))
    }
  }, [load, serverId, textChannelId])

  const current = snapshot.channelId === textChannelId
    ? snapshot
    : { channelId: textChannelId, permissions: null, status: 'loading' as const }

  return useMemo(() => ({
    status: current.status,
    permissions: current.permissions,
    canSendMessages: current.status === 'ready'
      && hasPermission(current.permissions, Permissions.SEND_MESSAGES),
    refresh: () => load(false),
  }), [current.permissions, current.status, load])
}
