'use client'

import { Headphones, MicOff } from 'lucide-react'
import { SpeakingAvatar } from '../SpeakingAvatar'
import { cn } from '../../lib/utils'

export interface VoiceParticipant {
  user_id: number
  username: string
  is_muted?: boolean
  is_deafened?: boolean
  avatar_url?: string | null
  display_name?: string
}

interface VoiceParticipantListProps {
  participants: VoiceParticipant[]
  currentUserId?: number
  speakingUsers: Record<number, boolean>
  screenSharingUsers: Set<number>
  activeProfileUserId?: number | null
  onOpenProfile: (participant: VoiceParticipant, anchorRect: DOMRect) => void
  onContextMenu: (event: React.MouseEvent, participant: VoiceParticipant) => void
  onStreamHoverStart: (participant: VoiceParticipant, anchorRect: DOMRect) => void
  onStreamHoverEnd: () => void
}

export function VoiceParticipantList({
  participants,
  currentUserId,
  speakingUsers,
  screenSharingUsers,
  activeProfileUserId,
  onOpenProfile,
  onContextMenu,
  onStreamHoverStart,
  onStreamHoverEnd,
}: VoiceParticipantListProps) {
  if (participants.length === 0) return null

  return (
    <div className="ml-6 mt-1 space-y-1">
      {participants.map((participant) => {
        const isScreenSharing = screenSharingUsers.has(participant.user_id)

        return (
          <div
            key={participant.user_id}
            className={cn(
              'interactive-row flex cursor-pointer items-center gap-2 overflow-visible px-2 py-1.5',
              activeProfileUserId === participant.user_id && 'bg-gray-800',
            )}
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            aria-expanded={activeProfileUserId === participant.user_id}
            onClick={(event) =>
              onOpenProfile(participant, event.currentTarget.getBoundingClientRect())
            }
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onOpenProfile(participant, event.currentTarget.getBoundingClientRect())
            }}
            onContextMenu={(event) => onContextMenu(event, participant)}
            onMouseEnter={(event) => {
              if (!isScreenSharing) return
              onStreamHoverStart(participant, event.currentTarget.getBoundingClientRect())
            }}
            onMouseLeave={() => {
              if (!isScreenSharing) return
              onStreamHoverEnd()
            }}
          >
            <SpeakingAvatar
              user={participant}
              isSpeaking={Boolean(speakingUsers[participant.user_id])}
              isScreenSharing={isScreenSharing}
            />
            <span
              className={cn(
                'flex-1 text-xs',
                participant.is_deafened ? 'text-red-400 line-through' : 'text-muted-foreground',
              )}
            >
              {participant.username}
              {participant.user_id === currentUserId && ' (Вы)'}
            </span>

            {isScreenSharing && (
              <span className="rounded bg-destructive px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                В эфире
              </span>
            )}

            <div className="flex gap-1">
              {participant.is_muted && <MicOff className="h-3 w-3 text-red-400" />}
              {participant.is_deafened && <Headphones className="h-3 w-3 text-red-400" />}
            </div>
          </div>
        )
      })}
    </div>
  )
}
