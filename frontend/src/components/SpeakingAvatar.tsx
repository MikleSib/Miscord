'use client'

import { UserAvatar } from './ui/user-avatar'
import { cn } from '../lib/utils'

interface SpeakingAvatarProps {
  user?: {
    username?: string
    display_name?: string
    avatar_url?: string | null
  } | null
  isSpeaking: boolean
  isScreenSharing?: boolean
  size?: number
  className?: string
}

export function SpeakingAvatar({
  user,
  isSpeaking,
  isScreenSharing = false,
  size = 24,
  className,
}: SpeakingAvatarProps) {
  const isActive = Boolean(isScreenSharing || isSpeaking)

  return (
    <span className={cn('speaking-avatar', isActive && 'is-speaking', className)}>
      <span className="speaking-avatar__ring" aria-hidden="true" />
      <UserAvatar
        user={user || undefined}
        size={size}
        className="speaking-avatar__face"
        sx={{
          backgroundColor: !user?.avatar_url ? '#5865f2' : 'transparent',
          color: 'white',
          fontWeight: 600,
          position: 'relative',
          zIndex: 1,
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      />
    </span>
  )
}
