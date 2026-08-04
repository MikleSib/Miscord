'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  Ban,
  Crown,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  Tag,
  UserMinus,
  Users,
  X,
} from 'lucide-react'

import { UserAvatar } from '../ui/user-avatar'
import serverService from '../../services/serverService'
import websocketService from '../../services/websocketService'
import { useAuthStore } from '../../store/store'
import { Permissions } from '../../lib/permissions'
import { useServerPermissions } from '../../lib/serverPermissions'
import { cn } from '../../lib/utils'
import { Role, Server, ServerMember } from '../../types'
import { ConfirmDialog } from './ConfirmDialog'
import { Dropdown, DropdownItem } from './Dropdown'
import { PromptDialog } from './PromptDialog'
import { EmptyState, ErrorBanner, TabShell, TextInput } from './layout'

interface ServerMembersTabProps {
  server: Server
}

type PendingAction =
  | { kind: 'kick'; member: ServerMember }
  | { kind: 'ban'; member: ServerMember }
  | { kind: 'transfer'; member: ServerMember }
  | { kind: 'nickname'; member: ServerMember }
  | null

export function ServerMembersTab({ server }: ServerMembersTabProps) {
  const currentUser = useAuthStore((state) => state.user)
  const { isOwner, topRolePosition, can } = useServerPermissions(server.id)

  const canKick = can(Permissions.KICK_MEMBERS)
  const canBan = can(Permissions.BAN_MEMBERS)
  const canManageRoles = can(Permissions.MANAGE_ROLES)
  const canManageNicknames = can(Permissions.MANAGE_NICKNAMES)

  const [members, setMembers] = useState<ServerMember[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [busyMemberId, setBusyMemberId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const [membersResponse, rolesResponse] = await Promise.all([
        serverService.getMembers(server.id),
        serverService.getRoles(server.id),
      ])
      setMembers(membersResponse.members)
      setRoles(rolesResponse)
    } catch (loadError: any) {
      console.error('Ошибка загрузки участников:', loadError)
      setError(loadError.response?.data?.detail || 'Не удалось загрузить участников')
    } finally {
      setIsLoading(false)
    }
  }, [server.id])

  useEffect(() => {
    void load()
  }, [load])

  // Список участников должен оставаться актуальным, пока настройки открыты
  useEffect(() => {
    const reload = (payload: any) => {
      const serverId = payload?.data?.server_id ?? payload?.channel_id ?? payload?.server_id
      if (serverId === server.id) {
        void load()
      }
    }

    const events = [
      'user_joined_channel',
      'user_left_channel',
      'server_member_updated',
      'server_member_roles_updated',
      'server_ownership_transferred',
      'server_role_created',
      'server_role_updated',
      'server_role_deleted',
    ]
    events.forEach((event) => websocketService.on(event, reload))
    return () => {
      events.forEach((event) => websocketService.off(event, reload))
    }
  }, [server.id, load])

  const assignableRoles = useMemo(
    () =>
      roles.filter(
        (role) => !role.is_default && (isOwner || role.position < topRolePosition)
      ),
    [roles, isOwner, topRolePosition]
  )

  const canActOn = useCallback(
    (member: ServerMember) => {
      if (member.user_id === currentUser?.id) return false
      if (member.is_owner) return false
      if (isOwner) return true
      return member.top_role_position < topRolePosition
    },
    [currentUser?.id, isOwner, topRolePosition]
  )

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return members
    return members.filter((member) => {
      const haystack = [member.nickname, member.display_name, member.username]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [members, search])

  const patchMember = (userId: number, patch: Partial<ServerMember>) => {
    setMembers((current) =>
      current.map((member) => (member.user_id === userId ? { ...member, ...patch } : member))
    )
  }

  const handleToggleRole = async (member: ServerMember, role: Role, attach: boolean) => {
    setBusyMemberId(member.user_id)
    setError('')
    try {
      const response = attach
        ? await serverService.addMemberRole(server.id, member.user_id, role.id)
        : await serverService.removeMemberRole(server.id, member.user_id, role.id)

      const nextRoleIds = response.role_ids
      const nextRoles = roles
        .filter((item) => nextRoleIds.includes(item.id))
        .sort((a, b) => b.position - a.position)

      patchMember(member.user_id, {
        role_ids: nextRoleIds,
        roles: nextRoles,
        color: nextRoles.find((item) => item.color)?.color ?? null,
        top_role_position: nextRoles.length ? nextRoles[0].position : 0,
      })
    } catch (roleError: any) {
      console.error('Ошибка изменения ролей участника:', roleError)
      setError(roleError.response?.data?.detail || 'Не удалось изменить роли участника')
    } finally {
      setBusyMemberId(null)
    }
  }

  const closeAction = () => {
    setPendingAction(null)
    setActionError('')
  }

  const handleConfirmAction = async (nicknameValue?: string) => {
    if (!pendingAction) return

    setIsSubmitting(true)
    setActionError('')
    try {
      const { kind, member } = pendingAction

      if (kind === 'kick') {
        await serverService.kickMember(server.id, member.user_id)
        setMembers((current) => current.filter((item) => item.user_id !== member.user_id))
      } else if (kind === 'ban') {
        await serverService.banMember(server.id, member.user_id)
        setMembers((current) => current.filter((item) => item.user_id !== member.user_id))
      } else if (kind === 'transfer') {
        await serverService.transferOwnership(server.id, member.user_id)
        await load()
      } else if (kind === 'nickname') {
        const trimmed = (nicknameValue ?? '').trim()
        await serverService.updateMemberNickname(server.id, member.user_id, trimmed || null)
        patchMember(member.user_id, { nickname: trimmed || null })
      }

      closeAction()
    } catch (submitError: any) {
      console.error('Ошибка действия над участником:', submitError)
      setActionError(submitError.response?.data?.detail || 'Не удалось выполнить действие')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <TabShell>
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Загружаем участников...
        </div>
      </TabShell>
    )
  }

  return (
    <TabShell>
      <ErrorBanner message={error} />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск участников"
            className="pl-9"
          />
        </div>
        <span className="flex-none text-sm text-muted-foreground">
          {members.length} {pluralizeMembers(members.length)}
        </span>
      </div>

      {filteredMembers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Никого не нашлось"
          description="Попробуйте изменить поисковый запрос."
        />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {filteredMembers.map((member) => {
            const displayName = member.nickname || member.display_name || member.username
            const actionable = canActOn(member)
            const isBusy = busyMemberId === member.user_id

            const memberAssignableRoles = assignableRoles.filter(
              (role) => !member.role_ids.includes(role.id)
            )

            const showMenu =
              (canKick && actionable) ||
              (canBan && actionable) ||
              (canManageNicknames && (actionable || member.user_id === currentUser?.id)) ||
              (isOwner && !member.is_owner)

            return (
              <div key={member.user_id} className="flex items-start gap-3 px-4 py-3">
                <div className="relative flex-none">
                  <UserAvatar user={member as any} size={40} />
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background',
                      member.is_online ? 'bg-green-500' : 'bg-muted-foreground'
                    )}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className="truncate text-sm font-medium"
                      style={member.color ? { color: member.color } : undefined}
                    >
                      {displayName}
                    </span>
                    {member.is_owner && (
                      <span
                        title="Владелец сервера"
                        className="flex items-center gap-1 rounded bg-yellow-500/15 px-1.5 py-0.5 text-xs text-yellow-500"
                      >
                        <Crown className="h-3 w-3" />
                        Владелец
                      </span>
                    )}
                    {member.nickname && (
                      <span className="truncate text-xs text-muted-foreground">
                        @{member.username}
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {member.joined_at
                      ? `Присоединился ${formatJoinDate(member.joined_at)}`
                      : 'Дата вступления неизвестна'}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {member.roles.map((role) => {
                      const removable =
                        canManageRoles && (isOwner || role.position < topRolePosition)
                      return (
                        <span
                          key={role.id}
                          className="flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs"
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: role.color || 'rgb(148 163 184)' }}
                          />
                          {role.name}
                          {removable && (
                            <button
                              type="button"
                              aria-label={`Убрать роль ${role.name}`}
                              disabled={isBusy}
                              onClick={() => handleToggleRole(member, role, false)}
                              className="ml-0.5 text-muted-foreground transition-colors hover:text-red-400 disabled:opacity-50"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      )
                    })}

                    {canManageRoles && memberAssignableRoles.length > 0 && (
                      <Dropdown
                        align="left"
                        trigger={() => (
                          <button
                            type="button"
                            disabled={isBusy}
                            className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                          >
                            <Plus className="h-3 w-3" />
                            Роль
                          </button>
                        )}
                      >
                        {({ close }) => (
                          <>
                            {memberAssignableRoles.map((role) => (
                              <DropdownItem
                                key={role.id}
                                onClick={() => {
                                  close()
                                  void handleToggleRole(member, role, true)
                                }}
                              >
                                <span className="flex items-center gap-2">
                                  <span
                                    className="h-2 w-2 flex-none rounded-full"
                                    style={{ backgroundColor: role.color || 'rgb(148 163 184)' }}
                                  />
                                  {role.name}
                                </span>
                              </DropdownItem>
                            ))}
                          </>
                        )}
                      </Dropdown>
                    )}
                  </div>
                </div>

                {isBusy && <Loader2 className="mt-2 h-4 w-4 flex-none animate-spin text-muted-foreground" />}

                {showMenu && !isBusy && (
                  <Dropdown
                    trigger={({ open }) => (
                      <button
                        type="button"
                        aria-label="Действия с участником"
                        className={cn(
                          'rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                          open && 'bg-accent text-foreground'
                        )}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    )}
                  >
                    {({ close }) => (
                      <>
                        {canManageNicknames && (actionable || member.user_id === currentUser?.id) && (
                          <DropdownItem
                            icon={Tag}
                            onClick={() => {
                              close()
                              setPendingAction({ kind: 'nickname', member })
                            }}
                          >
                            Изменить никнейм
                          </DropdownItem>
                        )}
                        {isOwner && !member.is_owner && (
                          <DropdownItem
                            icon={Crown}
                            onClick={() => {
                              close()
                              setPendingAction({ kind: 'transfer', member })
                            }}
                          >
                            Передать владение
                          </DropdownItem>
                        )}
                        {canKick && actionable && (
                          <DropdownItem
                            icon={UserMinus}
                            danger
                            onClick={() => {
                              close()
                              setPendingAction({ kind: 'kick', member })
                            }}
                          >
                            Исключить
                          </DropdownItem>
                        )}
                        {canBan && actionable && (
                          <DropdownItem
                            icon={Ban}
                            danger
                            onClick={() => {
                              close()
                              setPendingAction({ kind: 'ban', member })
                            }}
                          >
                            Заблокировать
                          </DropdownItem>
                        )}
                      </>
                    )}
                  </Dropdown>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingAction?.kind === 'kick'}
        title="Исключить участника"
        description={
          <>
            Исключить <strong>{memberLabel(pendingAction?.member)}</strong> с сервера? Он сможет
            вернуться по новому приглашению.
          </>
        }
        confirmLabel="Исключить"
        pendingLabel="Исключаем..."
        isPending={isSubmitting}
        error={actionError}
        onConfirm={() => handleConfirmAction()}
        onCancel={closeAction}
      />

      <ConfirmDialog
        open={pendingAction?.kind === 'ban'}
        title="Заблокировать участника"
        description={
          <>
            Заблокировать <strong>{memberLabel(pendingAction?.member)}</strong>? Он будет исключён и не
            сможет вернуться, пока блокировку не снимут.
          </>
        }
        confirmLabel="Заблокировать"
        pendingLabel="Блокируем..."
        isPending={isSubmitting}
        error={actionError}
        onConfirm={() => handleConfirmAction()}
        onCancel={closeAction}
      />

      <ConfirmDialog
        open={pendingAction?.kind === 'transfer'}
        title="Передать владение сервером"
        description={
          <>
            Сделать <strong>{memberLabel(pendingAction?.member)}</strong> владельцем сервера? Вы
            потеряете права владельца, и отменить это самостоятельно будет нельзя.
          </>
        }
        confirmLabel="Передать владение"
        pendingLabel="Передаём..."
        isPending={isSubmitting}
        error={actionError}
        onConfirm={() => handleConfirmAction()}
        onCancel={closeAction}
      />

      <PromptDialog
        open={pendingAction?.kind === 'nickname'}
        title="Серверный никнейм"
        description="Оставьте поле пустым, чтобы вернуть обычное имя пользователя."
        label="Никнейм"
        placeholder={pendingAction?.member?.username}
        initialValue={pendingAction?.member?.nickname || ''}
        maxLength={64}
        isPending={isSubmitting}
        error={actionError}
        onConfirm={(value) => handleConfirmAction(value)}
        onCancel={closeAction}
      />
    </TabShell>
  )
}

function memberLabel(member?: ServerMember): string {
  if (!member) return ''
  return member.nickname || member.display_name || member.username
}

function formatJoinDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'неизвестно'
  return format(parsed, 'd MMMM yyyy', { locale: ru })
}

function pluralizeMembers(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'участник'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'участника'
  return 'участников'
}
