import { User } from '../types'
import { useAuthStore } from '../store/store'
import { useStore } from './store'
import { useVoiceStore } from '../store/slices/voiceSlice'

export type UserProfileUpdate = {
  user_id: number
  username?: string
  display_name?: string | null
  avatar_url?: string | null
}

/** Применяет смену аватара/имени во всех локальных списках и шлёт событие для UI. */
export function applyUserProfileUpdate(update: UserProfileUpdate, options?: { emitEvent?: boolean }) {
  const { user_id, username, display_name, avatar_url } = update
  const patch: Partial<User> = {}
  if (username !== undefined) patch.username = username
  if (display_name !== undefined) patch.display_name = display_name ?? undefined
  if (avatar_url !== undefined) patch.avatar_url = avatar_url ?? undefined

  const authUser = useAuthStore.getState().user
  if (authUser && authUser.id === user_id) {
    useAuthStore.getState().updateUser({ ...authUser, ...patch })
  }

  const appState = useStore.getState()
  const nextMembers = (appState.currentServerMembers || []).map((member) =>
    member.id === user_id ? { ...member, ...patch } : member
  )
  const nextUser =
    appState.user && appState.user.id === user_id
      ? { ...appState.user, ...patch }
      : appState.user

  const nextMessages = Object.fromEntries(
    Object.entries(appState.messages || {}).map(([channelId, messages]) => [
      channelId,
      messages.map((message) => {
        let next = message
        if (message.author?.id === user_id) {
          next = { ...next, author: { ...next.author, ...patch } }
        }
        if (next.reply_to?.author?.id === user_id) {
          next = {
            ...next,
            reply_to: {
              ...next.reply_to,
              author: { ...next.reply_to.author, ...patch },
            },
          }
        }
        return next
      }),
    ])
  )

  useStore.setState({
    user: nextUser,
    currentServerMembers: nextMembers,
    messages: nextMessages,
  })

  const voice = useVoiceStore.getState()
  if (voice.participants.some((p) => p.user_id === user_id)) {
    useVoiceStore.setState({
      participants: voice.participants.map((p) =>
        p.user_id === user_id
          ? {
              ...p,
              username: username ?? p.username,
              display_name: display_name ?? p.display_name,
              avatar_url: avatar_url !== undefined ? avatar_url ?? undefined : p.avatar_url,
            }
          : p
      ),
    })
  }

  if (voice.p2pPeer?.id === user_id) {
    useVoiceStore.setState({
      p2pPeer: { ...voice.p2pPeer, ...patch },
    })
  }

  if (options?.emitEvent !== false && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('user_profile_updated', { detail: update }))
  }
}

// WebSocket и локальные экраны шлют одно событие — применяем его в сторы один раз
let profileSyncBound = false
export function bindUserProfileSync() {
  if (profileSyncBound || typeof window === 'undefined') return
  profileSyncBound = true

  window.addEventListener('user_profile_updated', (event) => {
    const detail = (event as CustomEvent).detail || {}
    const data = detail.data || detail
    if (!data?.user_id) return

    // Не эмитим снова — иначе зациклимся
    applyUserProfileUpdate(
      {
        user_id: data.user_id,
        username: data.username,
        display_name: data.display_name,
        avatar_url: data.avatar_url,
      },
      { emitEvent: false }
    )
  })
}

if (typeof window !== 'undefined') {
  bindUserProfileSync()
}
