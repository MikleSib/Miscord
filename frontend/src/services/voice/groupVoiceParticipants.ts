import type { VoiceJoinedPayload, VoiceParticipant } from './types'

type CurrentUser = {
  id: number
  username: string
  display_name?: string | null
  avatar_url?: string | null
}

export function participantsWithSelf(
  payload: VoiceJoinedPayload,
  user?: CurrentUser | null,
): VoiceParticipant[] {
  if (!user || payload.participants.some((item) => item.user_id === user.id)) {
    return payload.participants
  }
  return [...payload.participants, {
    user_id: user.id,
    username: user.username,
    display_name: user.display_name || undefined,
    avatar_url: user.avatar_url || undefined,
    is_muted: payload.self.is_muted,
    is_deafened: payload.self.is_deafened,
    stage_role: payload.self.stage_role,
    stage_suppressed: payload.self.stage_suppressed,
  }]
}
