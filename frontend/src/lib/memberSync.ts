import { User } from '../types'
import { useStore } from './store'

export type ServerMemberJoinPayload = {
  channel_id: number
  user_id: number
  username?: string
  display_name?: string | null
  avatar_url?: string | null
  user?: Partial<User> & { id: number }
}

export type ServerMemberLeftPayload = {
  channel_id: number
  user_id: number
}

function buildMemberFromPayload(payload: ServerMemberJoinPayload): User {
  if (payload.user?.id) {
    return {
      id: payload.user.id,
      username: payload.user.username ?? payload.username ?? 'User',
      email: payload.user.email ?? '',
      display_name: payload.user.display_name ?? payload.display_name ?? undefined,
      avatar_url: payload.user.avatar_url ?? payload.avatar_url ?? undefined,
      is_active: payload.user.is_active,
      is_online: payload.user.is_online,
      created_at: payload.user.created_at as string | undefined,
      updated_at: payload.user.updated_at as string | undefined,
    }
  }

  return {
    id: payload.user_id,
    username: payload.username ?? 'User',
    email: '',
    display_name: payload.display_name ?? undefined,
    avatar_url: payload.avatar_url ?? undefined,
  }
}

/** Мгновенно добавляет участника в правый список сервера без перезагрузки страницы. */
export function applyMemberJoined(payload: ServerMemberJoinPayload, options?: { emitEvent?: boolean }) {
  const serverId = payload.channel_id
  const { currentServer, currentServerMembers } = useStore.getState()
  if (!currentServer || currentServer.id !== serverId) return

  const member = buildMemberFromPayload(payload)
  if (currentServerMembers.some((existing) => existing.id === member.id)) return

  useStore.setState({
    currentServerMembers: [...currentServerMembers, member],
  })

  if (options?.emitEvent !== false && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('server_member_joined', { detail: { ...payload, user: member } }))
  }
}

/** Убирает участника из правого списка сервера без перезагрузки страницы. */
export function applyMemberLeft(payload: ServerMemberLeftPayload, options?: { emitEvent?: boolean }) {
  const serverId = payload.channel_id
  const { currentServer, currentServerMembers } = useStore.getState()
  if (!currentServer || currentServer.id !== serverId) return

  useStore.setState({
    currentServerMembers: currentServerMembers.filter((member) => member.id !== payload.user_id),
  })

  if (options?.emitEvent !== false && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('server_member_left', { detail: payload }))
  }
}

let memberSyncBound = false

export function bindMemberSync() {
  if (memberSyncBound || typeof window === 'undefined') return
  memberSyncBound = true

  window.addEventListener('server_member_joined', (event) => {
    const detail = (event as CustomEvent).detail || {}
    if (!detail?.channel_id || !detail?.user_id) return
    applyMemberJoined(detail, { emitEvent: false })
  })

  window.addEventListener('server_member_left', (event) => {
    const detail = (event as CustomEvent).detail || {}
    if (!detail?.channel_id || !detail?.user_id) return
    applyMemberLeft(detail, { emitEvent: false })
  })
}

if (typeof window !== 'undefined') {
  bindMemberSync()
}
