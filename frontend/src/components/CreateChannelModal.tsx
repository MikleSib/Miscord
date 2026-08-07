'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hash, Lock, MessageSquare, Smile, Volume2, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { Permissions } from '../lib/permissions'
import channelService from '../services/channelService'
import serverService from '../services/serverService'
import { Channel } from '../types'
import { Switch } from './ui/switch'

type ChannelCreateType = 'text' | 'voice' | 'forum'

interface CreateChannelModalProps {
  isOpen: boolean
  onClose: () => void
  serverId: number
  /** С какой вкладки открыли — текст или голос */
  initialType?: 'text' | 'voice'
  categoryLabel?: string
  onCreated: (channel: Channel) => void
}

const MODAL_Z_INDEX = 110

const TYPE_OPTIONS: Array<{
  id: ChannelCreateType
  label: string
  description: string
  icon: React.ReactNode
  disabled?: boolean
}> = [
  {
    id: 'text',
    label: 'Текст',
    description: 'Отправляйте сообщения, изображения, GIF, эмодзи, мнения и приколы',
    icon: <Hash className="h-6 w-6" />,
  },
  {
    id: 'voice',
    label: 'Голос',
    description: 'Общайтесь голосом или в видеочате и пользуйтесь функцией показа экрана',
    icon: <Volume2 className="h-6 w-6" />,
  },
  {
    id: 'forum',
    label: 'Форум',
    description: 'Создайте площадку для обсуждений',
    icon: <MessageSquare className="h-6 w-6" />,
    disabled: true,
  },
]

function slugifyChannelName(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-zа-яё0-9\-_]/gi, '')
}

export function CreateChannelModal({
  isOpen,
  onClose,
  serverId,
  initialType = 'text',
  categoryLabel,
  onCreated,
}: CreateChannelModalProps) {
  const [mounted, setMounted] = useState(false)
  const [channelType, setChannelType] = useState<ChannelCreateType>(initialType)
  const [channelName, setChannelName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setChannelType(initialType)
    setChannelName('')
    setIsPrivate(false)
    setError('')
    setIsCreating(false)
  }, [isOpen, initialType])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isCreating) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, isCreating, onClose])

  const canCreate = Boolean(channelName.trim()) && channelType !== 'forum' && !isCreating

  const makePrivateIfNeeded = async (created: Channel) => {
    if (!isPrivate) return
    try {
      const roles = await serverService.getRoles(serverId)
      const everyone = roles.find((role) => role.is_default)
      if (!everyone) return
      await channelService.upsertChannelPermissionOverwrite(created.type, created.id, {
        target_type: 'role',
        target_id: everyone.id,
        allow: 0,
        deny: Permissions.VIEW_CHANNELS,
      })
    } catch (privateError) {
      console.error('Не удалось сделать канал приватным:', privateError)
    }
  }

  const handleCreate = async () => {
    if (!canCreate) return
    const name = channelName.trim()
    setIsCreating(true)
    setError('')

    try {
      let created: Channel
      if (channelType === 'text') {
        const response = await channelService.createTextChannel(serverId, {
          name,
          position: 0,
        })
        created = {
          id: response.id,
          name: response.name,
          type: 'text',
          serverId,
          position: response.position,
          slow_mode_seconds: response.slow_mode_seconds ?? 0,
        }
      } else {
        const response = await channelService.createVoiceChannel(serverId, {
          name,
          position: 0,
          max_users: 0,
          bitrate: 64,
          video_quality: 'auto',
        })
        created = {
          id: response.id,
          name: response.name,
          type: 'voice',
          serverId,
          position: response.position,
          max_users: response.max_users ?? 0,
          bitrate: response.bitrate ?? 64,
          video_quality: response.video_quality === '720p' ? '720p' : 'auto',
        }
      }

      await makePrivateIfNeeded(created)
      onCreated(created)
      onClose()
    } catch (createError: any) {
      console.error('Ошибка создания канала:', createError)
      setError(createError.response?.data?.detail || 'Не удалось создать канал')
    } finally {
      setIsCreating(false)
    }
  }

  if (!isOpen || !mounted) return null

  const namePrefix = channelType === 'voice' ? 'volume' : 'hash'

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: MODAL_Z_INDEX }}>
      <div className="absolute inset-0 bg-black/70" onClick={() => !isCreating && onClose()} />

      <div className="relative w-full max-w-[460px] overflow-hidden rounded-xl bg-[#313338] shadow-2xl">
        <div className="px-4 pb-2 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white">Создать канал</h2>
              {categoryLabel && (
                <p className="mt-0.5 text-xs text-[#b5bac1]">в {categoryLabel}</p>
              )}
            </div>
            <button
              type="button"
              aria-label="Закрыть"
              disabled={isCreating}
              onClick={onClose}
              className="rounded p-1 text-[#b5bac1] transition hover:text-white disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="max-h-[min(70vh,560px)] space-y-5 overflow-y-auto px-4 pb-4 pt-2">
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#b5bac1]">
              Тип канала
            </p>
            <div className="space-y-2">
              {TYPE_OPTIONS.map((option) => {
                const selected = channelType === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={option.disabled || isCreating}
                    onClick={() => setChannelType(option.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition',
                      selected ? 'bg-[#43444b]' : 'bg-[#2b2d31] hover:bg-[#35373c]',
                      option.disabled && 'cursor-not-allowed opacity-45 hover:bg-[#2b2d31]'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                        selected ? 'border-[#5865f2]' : 'border-[#80848e]'
                      )}
                    >
                      {selected && <span className="h-2.5 w-2.5 rounded-full bg-[#5865f2]" />}
                    </span>

                    <span className="flex h-9 w-9 shrink-0 items-center justify-center text-[#b5bac1]">
                      {option.icon}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[15px] font-semibold text-white">{option.label}</span>
                        {option.disabled && (
                          <span className="rounded bg-[#1e1f22] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#949ba4]">
                            Скоро
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-sm leading-snug text-[#b5bac1]">
                        {option.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="create-channel-name"
              className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#b5bac1]"
            >
              Название канала
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#949ba4]">
                {namePrefix === 'hash' ? (
                  <Hash className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </span>
              <input
                id="create-channel-name"
                type="text"
                value={channelName}
                onChange={(event) => {
                  const next =
                    channelType === 'text'
                      ? slugifyChannelName(event.target.value)
                      : event.target.value
                  setChannelName(next)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canCreate) void handleCreate()
                }}
                placeholder="новый-канал"
                autoFocus
                maxLength={100}
                disabled={isCreating}
                className="w-full rounded-md border border-transparent bg-[#1e1f22] py-2.5 pl-9 pr-10 text-[15px] text-[#dbdee1] outline-none placeholder:text-[#6d6f78] focus:border-[#5865f2]"
              />
              <Smile className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#949ba4]" />
            </div>
          </div>

          <div className="rounded-lg">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2">
                <Lock className="h-4 w-4 shrink-0 text-[#dbdee1]" />
                <span className="text-[15px] font-semibold text-white">Приватный канал</span>
              </div>
              <Switch
                checked={isPrivate}
                disabled={isCreating}
                aria-label="Приватный канал"
                onCheckedChange={setIsPrivate}
              />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[#b5bac1]">
              Только выбранные участники и участники с выбранными ролями смогут просматривать этот
              канал.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 bg-[#2b2d31] px-4 py-4">
          <button
            type="button"
            disabled={isCreating}
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition hover:underline disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => void handleCreate()}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium transition',
              canCreate
                ? 'bg-[#5865f2] text-white hover:bg-[#4752c4]'
                : 'cursor-not-allowed bg-[#4752c4]/40 text-[#c9cdfb]/70'
            )}
          >
            {isCreating ? 'Создание...' : 'Создать канал'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
