'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Headphones, Mic, MicOff, Settings, VolumeX } from 'lucide-react'
import { SpeakingAvatar } from './SpeakingAvatar'
import { useVoiceStore } from '../store/slices/voiceSlice'
import { useAuthStore } from '../store/store'
import { cn } from '../lib/utils'

interface UserProfileBarProps {
  onSettingsClick?: () => void
  /** Встроен в общий dock — без собственной рамки */
  embedded?: boolean
}

export function UserProfileBar({ onSettingsClick, embedded = false }: UserProfileBarProps) {
  const { user } = useAuthStore()
  const { currentVoiceChannelId, isMuted, isDeafened, toggleMute, toggleDeafen, speakingUsers } = useVoiceStore()
  const [showCopiedTooltip, setShowCopiedTooltip] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
  }, [])

  const handleCopyUsername = async () => {
    if (!user?.username) return

    try {
      await navigator.clipboard.writeText(user.username)
      setShowCopiedTooltip(true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setShowCopiedTooltip(false), 1800)
    } catch (error) {
      console.error('Не удалось скопировать имя пользователя:', error)
    }
  }

  const isInVoiceChannel = Boolean(currentVoiceChannelId)
  const presenceLabel = user?.is_online === false ? '\u041d\u0435\u0432\u0438\u0434\u0438\u043c\u044b\u0439' : '\u0412 \u0441\u0435\u0442\u0438'

  return (
    <div
      className={cn(
        'relative z-[60] flex items-center overflow-visible',
        embedded ? 'user-dock__profile' : 'voice-panel',
        isInVoiceChannel && 'is-voice-connected'
      )}
    >
      <span className="user-dock__avatar overflow-visible">
        <SpeakingAvatar
          user={user}
          size={32}
          isSpeaking={Boolean(user?.id && speakingUsers[user.id])}
        />
        <i className={cn('user-dock__presence', user?.is_online && 'is-online')} aria-hidden="true" />
      </span>

      <button
        type="button"
        onClick={handleCopyUsername}
        className="interactive-row user-dock__identity relative z-[70] min-w-0 flex-1 overflow-visible text-left"
        title="Скопировать имя пользователя"
      >
        <span className="user-dock__display-name block truncate">
          {user?.display_name || user?.username}
        </span>
        <span className="user-dock__presence-label block truncate">
          {isInVoiceChannel ? presenceLabel : `@${user?.username}`}
        </span>
        {showCopiedTooltip && (
          <span
            role="status"
            className="pointer-events-none absolute bottom-full left-1 z-[100] mb-2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-foreground shadow-lg"
          >
            Скопировано
          </span>
        )}
      </button>

      <div className="user-dock__profile-controls">
        <div className={cn('voice-split-control', isMuted && 'is-danger')}>
          <button
          type="button"
          onClick={toggleMute}
          className="voice-split-control__main"
          aria-pressed={isMuted}
          title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
        >
            {isMuted ? <MicOff className="h-[18px] w-[18px]" /> : <Mic className="h-[18px] w-[18px]" />}
          </button>
          <button
            type="button"
            onClick={onSettingsClick}
            className="voice-split-control__menu"
            aria-label="Microphone settings"
            title="Microphone settings"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>

        <div className={cn('voice-output-control', isDeafened && 'is-danger')}>
          <button
          type="button"
          onClick={toggleDeafen}
          className="voice-icon-button"
          aria-pressed={isDeafened}
          title={isDeafened ? 'Включить звук' : 'Выключить звук'}
        >
            {isDeafened ? <VolumeX className="h-[18px] w-[18px]" /> : <Headphones className="h-[18px] w-[18px]" />}
          </button>
          <button
            type="button"
            onClick={onSettingsClick}
            className="voice-output-control__menu"
            aria-label="Output settings"
            title="Output settings"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        <button
          type="button"
          onClick={onSettingsClick}
          className="voice-icon-button"
          title="Настройки пользователя"
        >
          <Settings className="h-[19px] w-[19px]" />
        </button>
      </div>
    </div>
  )
}
