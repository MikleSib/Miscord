'use client'

import React from 'react'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'
import { cn } from '@/lib/utils'

interface UserAvatarProps {
  user?: {
    username?: string
    display_name?: string
    avatar_url?: string | null
  }
  size?: number
  className?: string
  /** @deprecated больше не нужен после ухода с MUI */
  sx?: Record<string, unknown>
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  user,
  size = 40,
  className = '',
}) => {
  const displayName = user?.display_name || user?.username || '?'
  const avatarUrl = user?.avatar_url || undefined
  const initial = displayName[0]?.toUpperCase() || '?'

  return (
    <Avatar
      key={avatarUrl || 'no-avatar'}
      className={cn('shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
      <AvatarFallback
        className="bg-primary text-primary-foreground font-semibold"
        style={{ fontSize: `${Math.max(10, size * 0.4)}px` }}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  )
}
