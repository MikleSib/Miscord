'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BellOff, ChevronDown, Hash, Loader2, Trash2, X } from 'lucide-react'

import { Switch } from './ui/switch'
import serverService from '../services/serverService'
import { useNotificationSettingsStore } from '../store/notificationSettingsStore'
import { cn } from '../lib/utils'
import {
  ChannelNotificationLevel,
  Server,
  ServerNotificationLevel,
  ServerNotificationSettings,
} from '../types'

interface ServerNotificationSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  server: Server
}

const MODAL_Z_INDEX = 120

const LEVEL_OPTIONS: Array<{ id: ServerNotificationLevel; label: string }> = [
  { id: 'all', label: 'Все сообщения' },
  { id: 'mentions', label: 'Только @упоминания' },
  { id: 'nothing', label: 'Ничего' },
]

const OVERRIDE_LEVELS: Array<{ id: ChannelNotificationLevel; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'mentions', label: 'Упоминания' },
  { id: 'nothing', label: 'Ничего' },
  { id: 'muted', label: 'Заглушить' },
]

export function ServerNotificationSettingsModal({
  isOpen,
  onClose,
  server,
}: ServerNotificationSettingsModalProps) {
  const [mounted, setMounted] = useState(false)
  const [settings, setSettings] = useState<ServerNotificationSettings | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [channelPickerOpen, setChannelPickerOpen] = useState(false)
  const setLocal = useNotificationSettingsStore((state) => state.setLocal)
  const load = useNotificationSettingsStore((state) => state.load)

  const textChannels = useMemo(
    () => (server.channels || []).filter((channel) => channel.type === 'text'),
    [server.channels]
  )

  const availableChannels = useMemo(() => {
    const used = new Set((settings?.channel_overrides || []).map((item) => item.text_channel_id))
    return textChannels.filter((channel) => !used.has(channel.id))
  }, [settings?.channel_overrides, textChannels])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    const fetchSettings = async () => {
      setIsLoading(true)
      setError('')
      setChannelPickerOpen(false)
      try {
        const next = await load(server.id, { force: true })
        if (!cancelled) setSettings(next)
      } catch (loadError: any) {
        if (!cancelled) {
          setError(loadError.response?.data?.detail || 'Не удалось загрузить настройки')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchSettings()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelled = true
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, load, onClose, server.id])

  const applySettings = async (
    patch: Partial<Omit<ServerNotificationSettings, 'server_id' | 'channel_overrides'>>
  ) => {
    if (!settings) return
    setIsSaving(true)
    setError('')
    try {
      const next = await serverService.updateNotificationSettings(server.id, patch)
      setSettings(next)
      setLocal(server.id, next)
    } catch (saveError: any) {
      console.error('Ошибка сохранения уведомлений:', saveError)
      setError(saveError.response?.data?.detail || 'Не удалось сохранить настройки')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddOverride = async (textChannelId: number) => {
    setIsSaving(true)
    setError('')
    setChannelPickerOpen(false)
    try {
      const next = await serverService.setChannelNotificationOverride(
        server.id,
        textChannelId,
        'mentions'
      )
      setSettings(next)
      setLocal(server.id, next)
    } catch (saveError: any) {
      setError(saveError.response?.data?.detail || 'Не удалось добавить канал')
    } finally {
      setIsSaving(false)
    }
  }

  const handleOverrideLevel = async (
    textChannelId: number,
    level: ChannelNotificationLevel
  ) => {
    setIsSaving(true)
    setError('')
    try {
      const next = await serverService.setChannelNotificationOverride(
        server.id,
        textChannelId,
        level
      )
      setSettings(next)
      setLocal(server.id, next)
    } catch (saveError: any) {
      setError(saveError.response?.data?.detail || 'Не удалось обновить канал')
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemoveOverride = async (textChannelId: number) => {
    setIsSaving(true)
    setError('')
    try {
      const next = await serverService.removeChannelNotificationOverride(
        server.id,
        textChannelId
      )
      setSettings(next)
      setLocal(server.id, next)
    } catch (saveError: any) {
      setError(saveError.response?.data?.detail || 'Не удалось удалить переопределение')
    } finally {
      setIsSaving(false)
    }
  }

  if (!mounted || !isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
      style={{ zIndex: MODAL_Z_INDEX }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-notifications-title"
        className="flex max-h-[min(90vh,720px)] w-full max-w-[440px] flex-col overflow-hidden rounded-lg bg-[#313338] shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 id="server-notifications-title" className="text-xl font-bold text-white">
            Параметры уведомлений
          </h2>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className="rounded p-1 text-[#b5bac1] transition hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {isLoading || !settings ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#949ba4]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Загрузка…
            </div>
          ) : (
            <div className="space-y-5 py-2">
              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}

              <SettingRow
                title={`Заглушить ${server.name}`}
                description="Заглушение сервера отключает всплывающие уведомления и оповещения о непрочитанных сообщениях, если вы не упомянуты."
                checked={settings.muted}
                disabled={isSaving}
                onChange={(muted) => void applySettings({ muted })}
              />

              <div className="border-t border-[#3f4147] pt-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#b5bac1]">
                  Параметры уведомлений сервера
                </p>
                <div className="space-y-1">
                  {LEVEL_OPTIONS.map((option) => {
                    const selected = settings.notification_level === option.id
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={isSaving || settings.muted}
                        onClick={() => void applySettings({ notification_level: option.id })}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition',
                          selected ? 'bg-[#2b2d31]' : 'hover:bg-[#2b2d31]/70',
                          settings.muted && 'cursor-not-allowed opacity-50'
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
                        <span className="text-[15px] text-[#dbdee1]">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
                {settings.muted && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-[#949ba4]">
                    <BellOff className="h-3.5 w-3.5" />
                    Пока сервер заглушен, действуют только упоминания.
                  </p>
                )}
              </div>

              <div className="space-y-4 border-t border-[#3f4147] pt-4">
                <SettingRow
                  title="Игнорировать @everyone и @here"
                  checked={settings.suppress_everyone}
                  disabled={isSaving}
                  onChange={(suppress_everyone) => void applySettings({ suppress_everyone })}
                />
                <SettingRow
                  title="Отключить все @упоминания ролей"
                  checked={settings.suppress_roles}
                  disabled={isSaving}
                  onChange={(suppress_roles) => void applySettings({ suppress_roles })}
                />
                <SettingRow
                  title="Отключить уведомления о важных событиях"
                  description="Раздел «В центре внимания» периодически уведомляет вас о важной активности на серверах."
                  checked={settings.suppress_highlights}
                  disabled={isSaving}
                  onChange={(suppress_highlights) => void applySettings({ suppress_highlights })}
                />
                <SettingRow
                  title="Заглушить новые события"
                  checked={settings.mute_events}
                  disabled={isSaving}
                  onChange={(mute_events) => void applySettings({ mute_events })}
                />
                <SettingRow
                  title="Мобильные Push-уведомления"
                  description="Отправлять уведомления на телефон или компьютер, когда вы не в Miscord."
                  checked={settings.mobile_push}
                  disabled={isSaving}
                  onChange={(mobile_push) => void applySettings({ mobile_push })}
                />
              </div>

              <div className="border-t border-[#3f4147] pt-4">
                <div className="relative mb-3">
                  <button
                    type="button"
                    disabled={isSaving || availableChannels.length === 0}
                    onClick={() => setChannelPickerOpen((open) => !open)}
                    className="flex w-full items-center justify-between rounded-md bg-[#1e1f22] px-3 py-2.5 text-left text-sm text-[#dbdee1] transition hover:bg-[#1a1b1e] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>
                      {availableChannels.length === 0
                        ? 'Все каналы уже добавлены'
                        : 'Выберите канал или категорию...'}
                    </span>
                    <ChevronDown className="h-4 w-4 text-[#949ba4]" />
                  </button>

                  {channelPickerOpen && availableChannels.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-[#1e1f22] bg-[#111214] py-1 shadow-xl">
                      {availableChannels.map((channel) => (
                        <button
                          key={channel.id}
                          type="button"
                          onClick={() => void handleAddOverride(channel.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#dbdee1] hover:bg-[#2b2d31]"
                        >
                          <Hash className="h-4 w-4 text-[#949ba4]" />
                          {channel.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <p className="mb-3 text-sm text-[#949ba4]">
                  Добавьте канал для переопределения его настроек уведомлений по умолчанию
                </p>

                <div className="overflow-hidden rounded-md border border-[#3f4147]">
                  <div className="grid grid-cols-[1fr_repeat(4,44px)_28px] gap-1 border-b border-[#3f4147] bg-[#2b2d31] px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-[#949ba4]">
                    <span>Канал</span>
                    {OVERRIDE_LEVELS.map((level) => (
                      <span key={level.id} className="text-center">
                        {level.label}
                      </span>
                    ))}
                    <span />
                  </div>

                  {settings.channel_overrides.length === 0 ? (
                    <div className="m-2 rounded border border-dashed border-[#3f4147] px-3 py-6 text-center text-sm text-[#949ba4]">
                      Добавьте канал для переопределения его настроек уведомлений по умолчанию
                    </div>
                  ) : (
                    <div className="divide-y divide-[#3f4147]">
                      {settings.channel_overrides.map((override) => {
                        const channel = textChannels.find(
                          (item) => item.id === override.text_channel_id
                        )
                        return (
                          <div
                            key={override.text_channel_id}
                            className="grid grid-cols-[1fr_repeat(4,44px)_28px] items-center gap-1 px-2 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-1.5 text-sm text-[#dbdee1]">
                              <Hash className="h-3.5 w-3.5 shrink-0 text-[#949ba4]" />
                              <span className="truncate">
                                {channel?.name || `Канал #${override.text_channel_id}`}
                              </span>
                            </div>
                            {OVERRIDE_LEVELS.map((level) => {
                              const selected = override.level === level.id
                              return (
                                <button
                                  key={level.id}
                                  type="button"
                                  disabled={isSaving}
                                  aria-label={level.label}
                                  onClick={() =>
                                    void handleOverrideLevel(override.text_channel_id, level.id)
                                  }
                                  className="mx-auto flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#80848e]"
                                  style={
                                    selected
                                      ? { borderColor: '#5865f2' }
                                      : undefined
                                  }
                                >
                                  {selected && (
                                    <span className="h-2.5 w-2.5 rounded-full bg-[#5865f2]" />
                                  )}
                                </button>
                              )
                            })}
                            <button
                              type="button"
                              aria-label="Удалить переопределение"
                              disabled={isSaving}
                              onClick={() => void handleRemoveOverride(override.text_channel_id)}
                              className="text-[#949ba4] transition hover:text-[#f23f43] disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[#3f4147] p-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-md bg-[#5865f2] py-2.5 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
          >
            Готово
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function SettingRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-[#f2f3f5]">{title}</p>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-[#b5bac1]">{description}</p>
        )}
      </div>
      <Switch
        className="mt-0.5"
        variant="brand"
        checked={checked}
        disabled={disabled}
        aria-label={title}
        onCheckedChange={onChange}
      />
    </div>
  )
}
