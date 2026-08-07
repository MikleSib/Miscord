'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Headphones, Mic, MicOff, Settings, VolumeX } from 'lucide-react'
import { SpeakingAvatar } from './SpeakingAvatar'
import { Tooltip } from './ui/tooltip'
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
  const presenceLabel = user?.is_online === false ? 'Невидимый' : 'В сети'

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

      <Tooltip content="Скопировать имя пользователя" className="min-w-0 flex-1">
        <button
          type="button"
          onClick={handleCopyUsername}
          className="interactive-row user-dock__identity relative z-[70] w-full min-w-0 overflow-visible text-left"
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
              className="miscord-tooltip miscord-tooltip--top is-visible pointer-events-none absolute bottom-full left-1 z-[100] mb-2"
              style={{ opacity: 1, visibility: 'visible', transform: 'translateX(0) translateY(0)' }}
            >
              Скопировано
            </span>
          )}
        </button>
      </Tooltip>

      <div className="user-dock__profile-controls">
        <div className={cn('voice-split-control', isMuted && 'is-danger')}>
          <Tooltip content={isMuted ? 'Вкл. микрофон' : 'Выключить микрофон'}>
            <button
              type="button"
              onClick={toggleMute}
              className="voice-split-control__main"
              aria-pressed={isMuted}
              aria-label={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            >
              {isMuted ? <MicOff className="h-[18px] w-[18px]" /> : <Mic className="h-[18px] w-[18px]" />}
            </button>
          </Tooltip>
          <Tooltip content="Настройки микрофона">
            <button
              type="button"
              onClick={onSettingsClick}
              className="voice-split-control__menu"
              aria-label="Настройки микрофона"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>

        <div className={cn('voice-output-control', isDeafened && 'is-danger')}>
          <Tooltip content={isDeafened ? 'Вкл. звук' : 'Выключить звук'}>
            <button
              type="button"
              onClick={toggleDeafen}
              className="voice-icon-button"
              aria-pressed={isDeafened}
              aria-label={isDeafened ? 'Включить звук' : 'Выключить звук'}
            >
              {isDeafened ? <VolumeX className="h-[18px] w-[18px]" /> : <Headphones className="h-[18px] w-[18px]" />}
            </button>
          </Tooltip>
          <Tooltip content="Настройки звука">
            <button
              type="button"
              onClick={onSettingsClick}
              className="voice-output-control__menu"
              aria-label="Настройки звука"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>

        <Tooltip content="Настройки пользователя">
          <button
            type="button"
            onClick={onSettingsClick}
            className="voice-icon-button"
            aria-label="Настройки пользователя"
          >
            <Settings className="h-[19px] w-[19px]" />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
