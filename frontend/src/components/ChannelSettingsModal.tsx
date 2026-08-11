'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, Hash, Trash2, Volume2, X } from 'lucide-react'
import { Button } from './ui/button'
import { Slider } from './ui/slider'
import { Channel } from '../types'
import channelService from '../services/channelService'
import {
  formatSlowModeHint,
  formatSlowModeLabel,
  SLOW_MODE_OPTIONS,
} from '../lib/slowMode'
import { cn } from '../lib/utils'
import { Permissions } from '../lib/permissions'
import { useServerPermissions } from '../lib/serverPermissions'
import { ChannelPermissionsTab } from './channel-settings/ChannelPermissionsTab'
import { ChannelWebhooksTab } from './channel-settings/ChannelWebhooksTab'
import { UnsavedChangesBar } from './channel-settings/UnsavedChangesBar'
import { useMobileSettingsDetail } from '../hooks/useMobileSettingsDetail'
import { useModalFocusTrap } from '../hooks/useModalFocusTrap'

type VideoQuality = 'auto' | '720p'

interface ChannelSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  channel: Channel
  onChannelUpdate: (updatedChannel: Channel) => void
  onChannelDelete?: (channelId: number, channelType?: 'text' | 'voice') => void
  onPermissionsChange?: () => void
}

type SettingsTab = 'overview' | 'permissions' | 'webhooks'

/** Выше сайдбара, профиля и lightbox. */
const MODAL_Z_INDEX = 100

export function ChannelSettingsModal({
  isOpen,
  onClose,
  channel,
  onChannelUpdate,
  onChannelDelete,
  onPermissionsChange,
}: ChannelSettingsModalProps) {
  const { can } = useServerPermissions(isOpen ? channel.serverId : null)
  const canManageWebhooks = can(Permissions.MANAGE_WEBHOOKS)
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview')
  const [channelName, setChannelName] = useState(channel.name)
  const [slowModeSeconds, setSlowModeSeconds] = useState(channel.slow_mode_seconds ?? 0)
  const [bitrate, setBitrate] = useState(channel.bitrate ?? 64)
  const [videoQuality, setVideoQuality] = useState<VideoQuality>(
    channel.video_quality === '720p' ? '720p' : 'auto'
  )
  const [maxUsers, setMaxUsers] = useState(channel.max_users ?? 0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [hasUnsavedOverview, setHasUnsavedOverview] = useState(false)
  const mobileSettings = useMobileSettingsDetail(isOpen)
  const closeModal = () => {
    mobileSettings.closeDetail()
    onClose()
  }
  const dialogRef = useModalFocusTrap<HTMLDivElement>(isOpen, () => {
    if (showDeleteConfirm) {
      setShowDeleteConfirm(false)
      return
    }
    closeModal()
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setActiveTab('overview')
    setChannelName(channel.name)
    setSlowModeSeconds(channel.slow_mode_seconds ?? 0)
    setBitrate(channel.bitrate ?? 64)
    setVideoQuality(channel.video_quality === '720p' ? '720p' : 'auto')
    setMaxUsers(channel.max_users ?? 0)
    setError('')
    setShowDeleteConfirm(false)
    setHasUnsavedOverview(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при открытии / смене канала
  }, [isOpen, channel.id])

  const handleSave = async () => {
    if (!channelName.trim()) {
      setError('Название канала не может быть пустым')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      let updatedChannel
      if (channel.type === 'text') {
        updatedChannel = await channelService.updateTextChannel(channel.id, {
          name: channelName.trim(),
          position: channel.position,
          slow_mode_seconds: slowModeSeconds,
        })
      } else {
        updatedChannel = await channelService.updateVoiceChannel(channel.id, {
          name: channelName.trim(),
          position: channel.position,
          bitrate,
          video_quality: videoQuality,
          max_users: maxUsers,
        })
      }

      onChannelUpdate({
        ...channel,
        name: updatedChannel.name,
        slow_mode_seconds: updatedChannel.slow_mode_seconds ?? slowModeSeconds,
        bitrate: updatedChannel.bitrate ?? bitrate,
        video_quality: updatedChannel.video_quality ?? videoQuality,
        max_users: updatedChannel.max_users ?? maxUsers,
      })
      setHasUnsavedOverview(false)
    } catch (saveError: any) {
      console.error('Ошибка сохранения настроек канала:', saveError)
      setError(saveError.response?.data?.detail || 'Не удалось сохранить настройки канала')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteChannel = async () => {
    setIsDeleting(true)
    try {
      if (channel.type === 'text') {
        await channelService.deleteTextChannel(channel.id)
      } else {
        await channelService.deleteVoiceChannel(channel.id)
      }

      onChannelDelete?.(channel.id, channel.type)
      onClose()
    } catch (deleteError: any) {
      console.error('Ошибка удаления канала:', deleteError)
      setError(deleteError.response?.data?.detail || 'Не удалось удалить канал')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const resetOverview = () => {
    setChannelName(channel.name)
    setSlowModeSeconds(channel.slow_mode_seconds ?? 0)
    setBitrate(channel.bitrate ?? 64)
    setVideoQuality(channel.video_quality === '720p' ? '720p' : 'auto')
    setMaxUsers(channel.max_users ?? 0)
    setError('')
    setHasUnsavedOverview(false)
  }

  if (!isOpen || !mounted) return null

  const navItemClass = (tab: SettingsTab) =>
    cn(
      'w-full rounded px-2.5 py-1.5 text-left text-[15px] transition',
      activeTab === tab
        ? 'bg-[#404249] font-medium text-white'
        : 'text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1]'
    )

  return createPortal(
    <div
      className="miscord-responsive-modal miscord-settings-dialog fixed inset-0 overflow-hidden bg-background"
      data-mobile-detail={mobileSettings.mobileDetailAttribute}
      style={{ zIndex: MODAL_Z_INDEX }}
    >
      {/* Центрированная колонка: навигация + контент */}
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="channel-settings-title" className="miscord-responsive-modal-card mx-auto flex h-full w-full max-w-[1080px] outline-none">
        <aside className="miscord-settings-sidebar flex w-[200px] shrink-0 flex-col bg-secondary px-2 pt-[60px] sm:w-[218px]">
          <div className="mb-2 px-2">
            <p className="truncate text-[11px] font-bold uppercase tracking-wide text-[#f2f3f5]">
              <span className="inline-flex items-center gap-1">
                {channel.type === 'text' ? (
                  <Hash className="h-3 w-3" />
                ) : (
                  <Volume2 className="h-3 w-3" />
                )}
                {channel.name}
              </span>
            </p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-[#949ba4]">
              {channel.type === 'text' ? 'Текстовый канал' : 'Голосовой канал'}
            </p>
          </div>

          <nav className="space-y-0.5">
            <button type="button" onClick={() => { setActiveTab('overview'); mobileSettings.openDetail() }} className={navItemClass('overview')}>
              Обзор
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('permissions'); mobileSettings.openDetail() }}
              className={navItemClass('permissions')}
            >
              Права доступа
            </button>
            {channel.type === 'text' && canManageWebhooks && (
              <button
                type="button"
                onClick={() => { setActiveTab('webhooks'); mobileSettings.openDetail() }}
                className={navItemClass('webhooks')}
              >
                Интеграция
              </button>
            )}
          </nav>

          <div className="my-2 mx-2 h-px bg-[#3f4147]" />

          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[15px] text-[#f23f43] transition hover:bg-[#f23f43]/10"
          >
            Удалить канал
            <Trash2 className="ml-auto h-4 w-4" />
          </button>
        </aside>

        <main className="miscord-settings-detail channel-settings-detail relative min-w-0 flex-1 flex-col bg-background">
          <div className="channel-settings-mobile-toolbar">
            <button type="button" onClick={mobileSettings.closeDetail} aria-label="К разделам настроек">
              <ChevronLeft aria-hidden="true" />
            </button>
            <h1 id="channel-settings-title">{activeTab === 'overview' ? 'Обзор' : activeTab === 'permissions' ? 'Права доступа' : 'Интеграция'}</h1>
            <button type="button" onClick={closeModal} aria-label="Закрыть настройки">
              <X aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Закрыть"
            className="channel-settings-desktop-close absolute right-3 top-4 z-20 flex flex-col items-center gap-1 text-text-muted transition hover:text-white sm:right-6 sm:top-10"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-current">
              <X className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide">Esc</span>
          </button>

          {activeTab === 'overview' ? (
            <div className="channel-settings-scroll h-full overflow-y-auto px-6 pb-28 pt-14 sm:px-10">
              <div className="mx-auto w-full max-w-[660px]">
                <h1 className="channel-settings-content-title mb-5 text-xl font-semibold text-white">Обзор</h1>

                {error && (
                  <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <div className="space-y-6">
                  <div>
                    <label
                      htmlFor="channelName"
                      className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#b5bac1]"
                    >
                      Название канала
                    </label>
                    <input
                      id="channelName"
                      type="text"
                      value={channelName}
                      onChange={(e) => {
                        setChannelName(e.target.value)
                        setHasUnsavedOverview(true)
                      }}
                      className="w-full rounded border-none bg-[#1e1f22] px-3 py-2.5 text-[#dbdee1] outline-none focus:ring-2 focus:ring-[#5865f2]"
                      maxLength={100}
                      placeholder="Введите название канала"
                    />
                  </div>

                  {channel.type === 'text' && (
                    <div>
                      <label
                        htmlFor="slowMode"
                        className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#b5bac1]"
                      >
                        Медленный режим
                      </label>
                      <div className="relative">
                        <select
                          id="slowMode"
                          value={slowModeSeconds}
                          onChange={(e) => {
                            setSlowModeSeconds(Number(e.target.value))
                            setHasUnsavedOverview(true)
                          }}
                          className="w-full appearance-none rounded border-none bg-[#1e1f22] px-3 py-2.5 pr-10 text-[#dbdee1] outline-none focus:ring-2 focus:ring-[#5865f2]"
                        >
                          {SLOW_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#949ba4]" />
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-[#b5bac1]">
                        {formatSlowModeHint(slowModeSeconds)}
                      </p>
                    </div>
                  )}

                  {channel.type === 'voice' && (
                    <div className="space-y-8">
                      <div>
                        <div className="mb-3 flex items-end justify-between">
                          <p className="text-xs font-bold uppercase tracking-wide text-white">
                            Битрейт
                          </p>
                          <p className="text-sm font-semibold text-[#00a8fc]">{bitrate}kbps</p>
                        </div>
                        <Slider
                          min={8}
                          max={96}
                          step={8}
                          value={[bitrate]}
                          onValueChange={([value]) => {
                            setBitrate(value)
                            setHasUnsavedOverview(true)
                          }}
                          className="bg-[#1e1f22] [&_.bg-blue-500]:bg-[#5865f2]"
                        />
                        <div className="mt-2 flex justify-between text-xs text-[#949ba4]">
                          <span>8kbps</span>
                          <span>64kbps</span>
                          <span>96kbps</span>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-[#b5bac1]">
                          ВНИМАНИЕ! Не поднимайте битрейт выше 64 кбит/с, чтобы не создать проблемы
                          людям с низкой скоростью соединения.
                        </p>
                      </div>

                      <div>
                        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-white">
                          Качество видео
                        </p>
                        <div className="space-y-1">
                          {(
                            [
                              { id: 'auto' as const, label: 'Автоматически' },
                              { id: '720p' as const, label: '720p' },
                            ] as const
                          ).map((option) => {
                            const selected = videoQuality === option.id
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => {
                                  setVideoQuality(option.id)
                                  setHasUnsavedOverview(true)
                                }}
                                className={cn(
                                  'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition',
                                  selected ? 'bg-[#2b2d31]' : 'hover:bg-[#2b2d31]/70'
                                )}
                              >
                                <span
                                  className={cn(
                                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                                    selected ? 'border-[#5865f2]' : 'border-[#80848e]'
                                  )}
                                >
                                  {selected && (
                                    <span className="h-2.5 w-2.5 rounded-full bg-[#5865f2]" />
                                  )}
                                </span>
                                <span className="text-[15px] text-[#dbdee1]">{option.label}</span>
                              </button>
                            )
                          })}
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-[#b5bac1]">
                          Устанавливает качество изображения для всех участников канала. Выберите
                          Автоматически для оптимальной производительности.
                        </p>
                      </div>

                      <div>
                        <div className="mb-3 flex items-end justify-between">
                          <p className="text-xs font-bold uppercase tracking-wide text-white">
                            Лимит пользователей
                          </p>
                          <p className="text-sm font-semibold text-[#00a8fc]">
                            {maxUsers === 0 ? '∞' : maxUsers}
                          </p>
                        </div>
                        <Slider
                          min={0}
                          max={99}
                          step={1}
                          value={[maxUsers]}
                          onValueChange={([value]) => {
                            setMaxUsers(value)
                            setHasUnsavedOverview(true)
                          }}
                          className="bg-[#1e1f22] [&_.bg-blue-500]:bg-[#5865f2]"
                        />
                        <div className="mt-2 flex justify-between text-xs text-[#949ba4]">
                          <span>∞</span>
                          <span>99</span>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-[#b5bac1]">
                          Ограничивает количество пользователей, которые могут подключаться к этому
                          голосовому каналу. Пользователи с правом на перемещение участников могут
                          игнорировать это ограничение и перемещать других пользователей в канал.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg bg-[#2b2d31] p-4">
                    <h3 className="mb-2 text-sm font-semibold text-[#f2f3f5]">Информация о канале</h3>
                    <div className="space-y-1 text-sm text-[#b5bac1]">
                      <p>Тип канала: {channel.type === 'text' ? 'Текстовый' : 'Голосовой'}</p>
                      <p>ID канала: {channel.id}</p>
                      {channel.type === 'text' && (
                        <p>Медленный режим: {formatSlowModeLabel(slowModeSeconds)}</p>
                      )}
                      {channel.type === 'voice' && (
                        <>
                          <p>Битрейт: {bitrate} кбит/с</p>
                          <p>
                            Качество видео:{' '}
                            {videoQuality === '720p' ? '720p' : 'Автоматически'}
                          </p>
                          <p>
                            Лимит пользователей: {maxUsers === 0 ? 'Без ограничений' : maxUsers}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <UnsavedChangesBar
                visible={hasUnsavedOverview}
                isSaving={isLoading}
                onReset={resetOverview}
                onSave={() => void handleSave()}
              />
            </div>
          ) : activeTab === 'permissions' ? (
            <ChannelPermissionsTab
              channel={channel}
              onPermissionsChange={onPermissionsChange}
            />
          ) : (
            <ChannelWebhooksTab channel={channel} />
          )}
        </main>
      </div>

      {/* Боковые поля фона, как «поля» вокруг центрированного блока */}
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[max(0px,calc((100%-1080px)/2))] bg-[#2b2d31] xl:block" />
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[max(0px,calc((100%-1080px)/2))] bg-[#313338] xl:block" />

      {showDeleteConfirm && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/70 p-4"
          style={{ zIndex: MODAL_Z_INDEX + 10 }}
        >
          <div className="w-full max-w-md rounded-xl bg-[#313338] p-6 shadow-2xl">
            <h3 className="mb-4 text-xl font-semibold text-white">Удалить канал</h3>
            <p className="mb-6 text-sm leading-relaxed text-[#b5bac1]">
              Вы уверены, что хотите удалить канал{' '}
              <strong className="text-[#f2f3f5]">«{channel.name}»</strong>? Канал будет скрыт для
              всех участников, но сообщения и вложения сохранятся на сервере.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="border-transparent bg-transparent text-[#b5bac1] hover:underline"
              >
                Отмена
              </Button>
              <Button
                onClick={() => void handleDeleteChannel()}
                disabled={isDeleting}
                className="bg-[#da373c] text-white hover:bg-[#a12828]"
              >
                {isDeleting ? 'Удаление...' : 'Удалить канал'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
