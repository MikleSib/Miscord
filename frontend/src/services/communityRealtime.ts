import { GatewayEvents } from '../lib/gatewayEvents'
import { useCommunityStore } from '../store/communityStore'
import type { InboxNotification, Thread } from '../types/community'
import unifiedWebSocketService from './unifiedWebSocketService'

let bound = false

function dataOf<T>(payload: T | { data: T }): T {
  return payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data: T }).data
    : payload as T
}

export function bindCommunityRealtime(refreshServers: () => void) {
  if (bound) return
  bound = true

  unifiedWebSocketService.on(GatewayEvents.NOTIFICATION_CREATE, (payload) => {
    useCommunityStore.getState().receiveNotification(dataOf<InboxNotification>(payload))
  })
  unifiedWebSocketService.on(GatewayEvents.NOTIFICATION_UPDATE, (payload) => {
    useCommunityStore.getState().replaceNotification(dataOf<InboxNotification>(payload))
  })
  unifiedWebSocketService.on(GatewayEvents.NOTIFICATION_DELETE, (payload) => {
    useCommunityStore.getState().applyNotificationDeleted(Number(dataOf<{ id: number }>(payload).id))
  })
  unifiedWebSocketService.on(GatewayEvents.NOTIFICATION_READ_ALL, () => {
    useCommunityStore.getState().applyReadAll()
  })
  unifiedWebSocketService.on(GatewayEvents.THREAD_UPDATE, (payload) => {
    useCommunityStore.getState().updateSelectedThread(dataOf<Partial<Thread> & Pick<Thread, 'id'>>(payload))
  })
  ;[
    GatewayEvents.THREAD_CREATE,
    GatewayEvents.THREAD_DELETE,
    GatewayEvents.FORUM_CREATE,
    GatewayEvents.FORUM_UPDATE,
  ].forEach((event) => unifiedWebSocketService.on(event, refreshServers))
}
