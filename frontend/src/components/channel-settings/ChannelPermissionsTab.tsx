'use client'

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Loader2, Lock, Plus, Search, Trash2 } from 'lucide-react'

import { UserAvatar } from '../ui/user-avatar'
import { Switch } from '../ui/switch'
import channelService from '../../services/channelService'
import serverService from '../../services/serverService'
import { Permissions } from '../../lib/permissions'
import { cn } from '../../lib/utils'
import {
  Channel,
  ChannelPermissionCatalogItem,
  ChannelPermissionOverwrite,
  Role,
  ServerMember,
} from '../../types'
import {
  ChannelOverwriteEditor,
  getOverwritePermissionState,
  setOverwritePermissionState,
} from './ChannelOverwriteEditor'
import { UnsavedChangesBar } from './UnsavedChangesBar'
import { ChannelPermissionTargetMenu } from './ChannelPermissionTargetMenu'
import { ChannelPermissionTargetList } from './ChannelPermissionTargetList'

interface ChannelPermissionsTabProps {
  channel: Channel
  onPermissionsChange?: () => void
}

type SelectedTarget = {
  target_type: 'role' | 'member'
  target_id: number
}

type PendingPatch = { allow: number; deny: number }

function targetKey(targetType: 'role' | 'member', targetId: number) {
  return `${targetType}:${targetId}`
}

export function ChannelPermissionsTab({
  channel,
  onPermissionsChange,
}: ChannelPermissionsTabProps) {
  const [catalog, setCatalog] = useState<ChannelPermissionCatalogItem[]>([])
  const [overwrites, setOverwrites] = useState<ChannelPermissionOverwrite[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [members, setMembers] = useState<ServerMember[]>([])
  const [selected, setSelected] = useState<SelectedTarget | null>(null)
  const [pending, setPending] = useState<Record<string, PendingPatch>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(true)
  const [addMenuPos, setAddMenuPos] = useState<{ top: number; left: number } | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)

  const everyoneRole = useMemo(
    () => roles.find((role) => role.is_default) ?? null,
    [roles]
  )

  const load = useCallback(async () => {
    setError('')
    setIsLoading(true)
    try {
      const [catalogResponse, overwritesResponse, rolesResponse, membersResponse] =
        await Promise.all([
          channelService.getChannelPermissionCatalog(channel.type),
          channelService.getChannelPermissionOverwrites(channel.type, channel.id),
          serverService.getRoles(channel.serverId),
          serverService.getMembers(channel.serverId),
        ])

      setCatalog(catalogResponse)
      setRoles(rolesResponse)
      setMembers(membersResponse.members)

      let nextOverwrites = overwritesResponse
      const everyone = rolesResponse.find((role) => role.is_default)

      if (
        everyone &&
        !nextOverwrites.some(
          (item) => item.target_type === 'role' && item.target_id === everyone.id
        )
      ) {
        const created = await channelService.upsertChannelPermissionOverwrite(
          channel.type,
          channel.id,
          {
            target_type: 'role',
            target_id: everyone.id,
            allow: 0,
            deny: 0,
          }
        )
        nextOverwrites = [created, ...nextOverwrites]
      }

      setOverwrites(nextOverwrites)
      setPending({})
      setSelected((current) => {
        if (
          current &&
          nextOverwrites.some(
            (item) =>
              item.target_type === current.target_type && item.target_id === current.target_id
          )
        ) {
          return current
        }
        if (everyone) {
          return { target_type: 'role', target_id: everyone.id }
        }
        const first = nextOverwrites[0]
        return first
          ? { target_type: first.target_type, target_id: first.target_id }
          : null
      })
    } catch (loadError: any) {
      console.error('Ошибка загрузки прав канала:', loadError)
      setError(loadError.response?.data?.detail || 'Не удалось загрузить права доступа')
    } finally {
      setIsLoading(false)
    }
  }, [channel.id, channel.serverId, channel.type])

  useEffect(() => {
    void load()
  }, [load])

  const updateAddMenuPosition = useCallback(() => {
    const button = addButtonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuWidth = 288
    const gap = 8
    const left = Math.min(
      Math.max(8, rect.right - menuWidth),
      window.innerWidth - menuWidth - 8
    )
    const top = Math.min(rect.bottom + gap, window.innerHeight - 16)
    setAddMenuPos({ top, left })
  }, [])

  useLayoutEffect(() => {
    if (!showAddMenu) {
      setAddMenuPos(null)
      return
    }
    updateAddMenuPosition()
    window.addEventListener('resize', updateAddMenuPosition)
    window.addEventListener('scroll', updateAddMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateAddMenuPosition)
      window.removeEventListener('scroll', updateAddMenuPosition, true)
    }
  }, [showAddMenu, updateAddMenuPosition])

  useEffect(() => {
    if (!showAddMenu) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (addMenuRef.current?.contains(target) || addButtonRef.current?.contains(target)) {
        return
      }
      setShowAddMenu(false)
      setAddQuery('')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowAddMenu(false)
        setAddQuery('')
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [showAddMenu])

  const getEffective = useCallback(
    (item: ChannelPermissionOverwrite): PendingPatch => {
      const key = targetKey(item.target_type, item.target_id)
      return pending[key] ?? { allow: item.allow, deny: item.deny }
    },
    [pending]
  )

  const selectedOverwrite = useMemo(
    () =>
      selected
        ? overwrites.find(
            (item) =>
              item.target_type === selected.target_type && item.target_id === selected.target_id
          ) ?? null
        : null,
    [overwrites, selected]
  )

  const selectedDraft = selectedOverwrite ? getEffective(selectedOverwrite) : null

  const hasUnsaved = Object.keys(pending).length > 0

  const isPrivate = useMemo(() => {
    if (!everyoneRole) return false
    const everyoneOverwrite = overwrites.find(
      (item) => item.target_type === 'role' && item.target_id === everyoneRole.id
    )
    if (!everyoneOverwrite) return false
    const effective = getEffective(everyoneOverwrite)
    return (
      getOverwritePermissionState(
        effective.allow,
        effective.deny,
        Permissions.VIEW_CHANNELS
      ) === 'deny'
    )
  }, [everyoneRole, getEffective, overwrites])

  const availableRoles = useMemo(() => {
    const used = new Set(
      overwrites.filter((item) => item.target_type === 'role').map((item) => item.target_id)
    )
    return roles
      .filter((role) => !used.has(role.id))
      .sort((a, b) => b.position - a.position)
  }, [overwrites, roles])

  const availableMembers = useMemo(() => {
    const used = new Set(
      overwrites.filter((item) => item.target_type === 'member').map((item) => item.target_id)
    )
    return members.filter((member) => !used.has(member.user_id))
  }, [members, overwrites])

  const filteredAddOptions = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    const roleOptions = availableRoles
      .filter((role) => !q || role.name.toLowerCase().includes(q))
      .map((role) => ({
        kind: 'role' as const,
        id: role.id,
        name: role.name,
        color: role.color,
      }))
    const memberOptions = availableMembers
      .filter((member) => {
        const name = (member.nickname || member.display_name || member.username || '').toLowerCase()
        return !q || name.includes(q)
      })
      .map((member) => ({
        kind: 'member' as const,
        id: member.user_id,
        name: member.nickname || member.display_name || member.username,
        avatar: member.avatar_url,
      }))
    return [...roleOptions, ...memberOptions]
  }, [addQuery, availableMembers, availableRoles])

  const updatePending = (
    targetType: 'role' | 'member',
    targetId: number,
    allow: number,
    deny: number
  ) => {
    const key = targetKey(targetType, targetId)
    const original = overwrites.find(
      (item) => item.target_type === targetType && item.target_id === targetId
    )
    setPending((current) => {
      const next = { ...current }
      if (original && original.allow === allow && original.deny === deny) {
        delete next[key]
      } else {
        next[key] = { allow, deny }
      }
      return next
    })
  }

  const handleReset = () => {
    setPending({})
    setError('')
  }

  const handleSave = async () => {
    const entries = Object.entries(pending)
    if (!entries.length) return

    setIsSaving(true)
    setError('')
    try {
      const updatedList = [...overwrites]
      for (const [key, patch] of entries) {
        const [targetType, targetIdRaw] = key.split(':') as ['role' | 'member', string]
        const targetId = Number(targetIdRaw)
        const updated = await channelService.upsertChannelPermissionOverwrite(
          channel.type,
          channel.id,
          {
            target_type: targetType,
            target_id: targetId,
            allow: patch.allow,
            deny: patch.deny,
          }
        )
        const index = updatedList.findIndex(
          (item) => item.target_type === targetType && item.target_id === targetId
        )
        if (index >= 0) updatedList[index] = updated
        else updatedList.push(updated)
      }
      setOverwrites(updatedList)
      setPending({})
      // Обновляем список каналов у других пользователей, но окно НЕ закрываем
      onPermissionsChange?.()
    } catch (saveError: any) {
      console.error('Ошибка сохранения прав:', saveError)
      setError(saveError.response?.data?.detail || 'Не удалось сохранить права')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddTarget = async (targetType: 'role' | 'member', targetId: number) => {
    setIsSaving(true)
    setError('')
    setShowAddMenu(false)
    setAddQuery('')
    try {
      const allow = isPrivate ? Permissions.VIEW_CHANNELS : 0
      const created = await channelService.upsertChannelPermissionOverwrite(
        channel.type,
        channel.id,
        {
          target_type: targetType,
          target_id: targetId,
          allow,
          deny: 0,
        }
      )
      setOverwrites((current) => {
        const without = current.filter(
          (item) => !(item.target_type === targetType && item.target_id === targetId)
        )
        return [...without, created]
      })
      setSelected({ target_type: targetType, target_id: targetId })
      onPermissionsChange?.()
    } catch (saveError: any) {
      console.error('Ошибка добавления прав:', saveError)
      setError(saveError.response?.data?.detail || 'Не удалось добавить права')
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!selectedOverwrite || selectedOverwrite.is_default_role) return

    setIsSaving(true)
    setError('')
    try {
      await channelService.deleteChannelPermissionOverwrite(
        channel.type,
        channel.id,
        selectedOverwrite.target_type,
        selectedOverwrite.target_id
      )
      const key = targetKey(selectedOverwrite.target_type, selectedOverwrite.target_id)
      setPending((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      const remaining = overwrites.filter(
        (item) =>
          !(
            item.target_type === selectedOverwrite.target_type &&
            item.target_id === selectedOverwrite.target_id
          )
      )
      setOverwrites(remaining)
      if (everyoneRole) {
        setSelected({ target_type: 'role', target_id: everyoneRole.id })
      } else {
        const next = remaining[0]
        setSelected(
          next ? { target_type: next.target_type, target_id: next.target_id } : null
        )
      }
      onPermissionsChange?.()
    } catch (removeError: any) {
      console.error('Ошибка удаления прав:', removeError)
      setError(removeError.response?.data?.detail || 'Не удалось удалить права')
    } finally {
      setIsSaving(false)
    }
  }

  const handlePrivateToggle = () => {
    if (!everyoneRole) return
    const everyoneOverwrite = overwrites.find(
      (item) => item.target_type === 'role' && item.target_id === everyoneRole.id
    )
    if (!everyoneOverwrite) return

    const current = getEffective(everyoneOverwrite)
    const next = setOverwritePermissionState(
      current.allow,
      current.deny,
      Permissions.VIEW_CHANNELS,
      isPrivate ? 'inherit' : 'deny'
    )
    updatePending('role', everyoneRole.id, next.allow, next.deny)
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[#949ba4]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Загрузка прав доступа...
      </div>
    )
  }

  const sortedOverwrites = [...overwrites].sort((a, b) => {
    if (a.is_default_role) return -1
    if (b.is_default_role) return 1
    if (a.target_type !== b.target_type) return a.target_type === 'role' ? -1 : 1
    return a.target_name.localeCompare(b.target_name, 'ru')
  })

  return (
    <div className="channel-settings-scroll relative h-full overflow-y-auto px-6 pb-28 pt-14 sm:px-10">
      <div className="mx-auto w-full max-w-[740px]">
        <h1 className="text-xl font-semibold text-white">Права канала</h1>
        <p className="mt-1 text-sm text-[#b5bac1]">
          Используйте права, чтобы настроить возможности пользователей на этом канале.
        </p>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="channel-permissions-private-card mt-6 flex items-start justify-between gap-6 rounded-lg bg-[#2b2d31] px-4 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-[#dbdee1]" />
            <div>
              <p className="text-base font-semibold text-white">Приватный канал</p>
              <p className="mt-1 text-sm leading-relaxed text-[#b5bac1]">
                Если сделать канал приватным, только выбранные вами участники и роли смогут
                просматривать его.
              </p>
            </div>
          </div>
          <Switch
            className="mt-1"
            checked={isPrivate}
            disabled={!everyoneRole || isSaving}
            aria-label="Приватный канал"
            onCheckedChange={() => handlePrivateToggle()}
          />
        </div>

        <div className="mt-8">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex items-center gap-2 text-base font-semibold text-white"
          >
            Расширенные права
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-180')}
            />
          </button>

          {advancedOpen && (
            <div className="channel-permissions-workspace mt-4 flex min-h-[480px] overflow-hidden rounded-lg bg-[#2b2d31]">
              <div className="channel-permissions-targets relative flex w-[200px] shrink-0 flex-col border-r border-[#1e1f22] sm:w-[220px]">
                <div className="flex items-center justify-between px-3 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#949ba4]">
                    Роли/Участники
                  </p>
                  <div className="relative">
                    <button
                      ref={addButtonRef}
                      type="button"
                      aria-label="Добавить роль или участника"
                      aria-expanded={showAddMenu}
                      disabled={isSaving || filteredAddOptions.length === 0}
                      onClick={() => {
                        if (showAddMenu) {
                          setShowAddMenu(false)
                          setAddQuery('')
                          return
                        }
                        updateAddMenuPosition()
                        setShowAddMenu(true)
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[#b5bac1] transition hover:bg-[#35373c] hover:text-white disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                    </button>

                    <ChannelPermissionTargetMenu model={{
                      showAddMenu, addMenuPos, addMenuRef, addQuery, setAddQuery,
                      filteredAddOptions, handleAddTarget,
                    }} />
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                <ChannelPermissionTargetList model={{
                  sortedOverwrites, selected, setSelected, pending,
                }} />
                <a
                  href="#"
                  onClick={(event) => event.preventDefault()}
                  className="px-3 py-3 text-sm text-[#00a8fc] hover:underline"
                >
                  Нужна помощь с правами?
                </a>
                </div>
              </div>

              <div className="channel-permissions-editor min-w-0 flex-1 overflow-y-auto px-5 py-4">
                {selectedOverwrite && selectedDraft ? (
                  <>
                    {!selectedOverwrite.is_default_role && (
                      <div className="mb-4 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void handleRemove()}
                          disabled={isSaving}
                          className="inline-flex items-center rounded px-2 py-1 text-sm text-[#f23f43] transition hover:bg-[#f23f43]/10 disabled:opacity-50"
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Удалить переопределение
                        </button>
                      </div>
                    )}

                    <ChannelOverwriteEditor
                      permissions={catalog}
                      allow={selectedDraft.allow}
                      deny={selectedDraft.deny}
                      disabled={isSaving}
                      onChange={({ allow, deny }) => {
                        updatePending(
                          selectedOverwrite.target_type,
                          selectedOverwrite.target_id,
                          allow,
                          deny
                        )
                      }}
                    />
                  </>
                ) : (
                  <p className="text-sm text-[#949ba4]">
                    Выберите роль или участника слева, чтобы настроить права.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <UnsavedChangesBar
        visible={hasUnsaved}
        isSaving={isSaving}
        onReset={handleReset}
        onSave={() => void handleSave()}
      />
    </div>
  )
}
