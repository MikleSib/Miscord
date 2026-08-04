'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  Shield,
  Trash2,
  Users,
} from 'lucide-react'

import { Button } from '../ui/button'
import serverService from '../../services/serverService'
import websocketService from '../../services/websocketService'
import { Permissions } from '../../lib/permissions'
import { useServerPermissions } from '../../lib/serverPermissions'
import { cn } from '../../lib/utils'
import { PermissionCatalog, Role, Server } from '../../types'
import { ConfirmDialog } from './ConfirmDialog'
import { RoleColorPicker } from './RoleColorPicker'
import { RolePermissionEditor } from './RolePermissionEditor'
import { ErrorBanner, FieldLabel, TabShell, TextInput } from './layout'

interface ServerRolesTabProps {
  server: Server
}

/** Черновик редактируемой роли — сохраняем только по кнопке. */
interface RoleDraft {
  name: string
  color: string | null
  permissions: number
}

export function ServerRolesTab({ server }: ServerRolesTabProps) {
  const { isOwner, topRolePosition, permissions: ownPermissions, can } = useServerPermissions(
    server.id
  )
  const canManage = can(Permissions.MANAGE_ROLES)

  const [roles, setRoles] = useState<Role[]>([])
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null)
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
  const [draft, setDraft] = useState<RoleDraft | null>(null)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isReordering, setIsReordering] = useState(false)
  const [error, setError] = useState('')

  const [pendingDelete, setPendingDelete] = useState<Role | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [rolesResponse, catalogResponse] = await Promise.all([
        serverService.getRoles(server.id),
        serverService.getPermissionCatalog(),
      ])
      setRoles(rolesResponse)
      setCatalog(catalogResponse)
      setSelectedRoleId((current) => {
        if (current && rolesResponse.some((role) => role.id === current)) return current
        return rolesResponse.length ? rolesResponse[0].id : null
      })
    } catch (loadError: any) {
      console.error('Ошибка загрузки ролей:', loadError)
      setError(loadError.response?.data?.detail || 'Не удалось загрузить роли')
    } finally {
      setIsLoading(false)
    }
  }, [server.id])

  useEffect(() => {
    void load()
  }, [load])

  // Роли могут меняться другими администраторами, пока вкладка открыта
  useEffect(() => {
    const reload = (payload: any) => {
      const serverId = payload?.data?.server_id ?? payload?.server_id
      if (serverId === server.id) {
        void load()
      }
    }
    const events = [
      'server_role_created',
      'server_role_updated',
      'server_role_deleted',
      'server_roles_reordered',
    ]
    events.forEach((event) => websocketService.on(event, reload))
    return () => {
      events.forEach((event) => websocketService.off(event, reload))
    }
  }, [server.id, load])

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  )

  // Черновик пересоздаём при переключении роли
  useEffect(() => {
    if (!selectedRole) {
      setDraft(null)
      return
    }
    setDraft({
      name: selectedRole.name,
      color: selectedRole.color ?? null,
      permissions: selectedRole.permissions,
    })
  }, [selectedRole?.id, selectedRole?.name, selectedRole?.color, selectedRole?.permissions])

  /** Роль можно редактировать, только если она ниже вашей высшей роли. */
  const canEditRole = useCallback(
    (role: Role) => {
      if (!canManage) return false
      if (isOwner) return true
      return role.position < topRolePosition
    },
    [canManage, isOwner, topRolePosition]
  )

  const isEditable = selectedRole ? canEditRole(selectedRole) : false

  const hasChanges = useMemo(() => {
    if (!selectedRole || !draft) return false
    return (
      draft.name.trim() !== selectedRole.name ||
      (draft.color ?? null) !== (selectedRole.color ?? null) ||
      draft.permissions !== selectedRole.permissions
    )
  }, [selectedRole, draft])

  const handleCreateRole = async () => {
    setIsCreating(true)
    setError('')
    try {
      const created = await serverService.createRole(server.id, {
        name: 'Новая роль',
        color: null,
        permissions: 0,
      })
      setRoles((current) =>
        [...current, { ...created, members_count: 0 }].sort((a, b) => b.position - a.position)
      )
      setSelectedRoleId(created.id)
    } catch (createError: any) {
      console.error('Ошибка создания роли:', createError)
      setError(createError.response?.data?.detail || 'Не удалось создать роль')
    } finally {
      setIsCreating(false)
    }
  }

  const handleSave = async () => {
    if (!selectedRole || !draft) return

    const name = draft.name.trim()
    if (!selectedRole.is_default && !name) {
      setError('Название роли не может быть пустым')
      return
    }

    setIsSaving(true)
    setError('')
    try {
      // @everyone нельзя переименовать и покрасить — отправляем только права
      const payload = selectedRole.is_default
        ? { permissions: draft.permissions }
        : { name, color: draft.color, permissions: draft.permissions }

      const updated = await serverService.updateRole(server.id, selectedRole.id, payload)
      setRoles((current) =>
        current.map((role) =>
          role.id === updated.id
            ? { ...role, ...updated, members_count: role.members_count }
            : role
        )
      )
    } catch (saveError: any) {
      console.error('Ошибка сохранения роли:', saveError)
      setError(saveError.response?.data?.detail || 'Не удалось сохранить роль')
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    if (!selectedRole) return
    setDraft({
      name: selectedRole.name,
      color: selectedRole.color ?? null,
      permissions: selectedRole.permissions,
    })
    setError('')
  }

  const handleDelete = async () => {
    if (!pendingDelete) return

    setIsDeleting(true)
    setDeleteError('')
    try {
      await serverService.deleteRole(server.id, pendingDelete.id)
      setRoles((current) => current.filter((role) => role.id !== pendingDelete.id))
      setSelectedRoleId((current) => (current === pendingDelete.id ? null : current))
      setPendingDelete(null)
    } catch (deleteFailure: any) {
      console.error('Ошибка удаления роли:', deleteFailure)
      setDeleteError(deleteFailure.response?.data?.detail || 'Не удалось удалить роль')
    } finally {
      setIsDeleting(false)
    }
  }

  /** Перемещение роли в иерархии. direction: -1 — выше, +1 — ниже. */
  const handleMove = async (role: Role, direction: -1 | 1) => {
    const custom = roles.filter((item) => !item.is_default)
    const index = custom.findIndex((item) => item.id === role.id)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= custom.length) return

    const reordered = [...custom]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)

    // Оптимистично обновляем позиции: первый в списке — самый высокий
    const total = reordered.length
    const positionById = new Map(
      reordered.map((item, itemIndex) => [item.id, total - itemIndex])
    )
    setRoles((current) =>
      current
        .map((item) =>
          positionById.has(item.id)
            ? { ...item, position: positionById.get(item.id) as number }
            : item
        )
        .sort((a, b) => b.position - a.position)
    )

    setIsReordering(true)
    setError('')
    try {
      await serverService.reorderRoles(
        server.id,
        reordered.map((item) => item.id)
      )
    } catch (reorderError: any) {
      console.error('Ошибка изменения порядка ролей:', reorderError)
      setError(reorderError.response?.data?.detail || 'Не удалось изменить порядок ролей')
      await load()
    } finally {
      setIsReordering(false)
    }
  }

  if (isLoading) {
    return (
      <TabShell>
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Загружаем роли...
        </div>
      </TabShell>
    )
  }

  const customRoles = roles.filter((role) => !role.is_default)

  return (
    <TabShell
      className="px-0 py-0"
      footer={
        isEditable && hasChanges ? (
          <div className="flex items-center justify-end gap-3">
            <span className="mr-auto text-sm text-muted-foreground">
              Есть несохранённые изменения
            </span>
            <Button variant="ghost" onClick={handleReset} disabled={isSaving}>
              Сбросить
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex h-full min-h-0">
        {/* Список ролей */}
        <div className="flex w-56 flex-none flex-col border-r border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Роли — {roles.length}
            </span>
            {canManage && (
              <button
                type="button"
                aria-label="Создать роль"
                title="Создать роль"
                disabled={isCreating}
                onClick={handleCreateRole}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </button>
            )}
          </div>

          <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
            {roles.map((role) => {
              const editable = canEditRole(role)
              const customIndex = customRoles.findIndex((item) => item.id === role.id)

              return (
                <div
                  key={role.id}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors',
                    selectedRoleId === role.id ? 'bg-accent' : 'hover:bg-accent/60'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedRoleId(role.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{ backgroundColor: role.color || 'rgb(148 163 184)' }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-sm"
                        style={role.color ? { color: role.color } : undefined}
                      >
                        {role.name}
                      </span>
                      {typeof role.members_count === 'number' && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" />
                          {role.members_count}
                        </span>
                      )}
                    </span>
                  </button>

                  {editable && !role.is_default && (
                    <span className="flex flex-none flex-col opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label="Поднять роль"
                        disabled={isReordering || customIndex <= 0}
                        onClick={() => handleMove(role, -1)}
                        className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Опустить роль"
                        disabled={isReordering || customIndex >= customRoles.length - 1}
                        onClick={() => handleMove(role, 1)}
                        className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Редактор роли */}
        <div className="scrollbar-thin min-w-0 flex-1 overflow-y-auto px-6 py-5">
          <ErrorBanner message={error} />

          {!selectedRole || !draft || !catalog ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Shield className="mb-3 h-8 w-8" />
              Выберите роль слева, чтобы настроить её права
            </div>
          ) : (
            <>
              {!isEditable && (
                <div className="mb-6 rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
                  {canManage
                    ? 'Эта роль не ниже вашей высшей роли, поэтому доступна только для просмотра.'
                    : 'У вас нет права «Управлять ролями» — настройки доступны только для просмотра.'}
                </div>
              )}

              {selectedRole.is_default ? (
                <div className="mb-6 rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
                  Роль <strong>@everyone</strong> есть у всех участников. Её нельзя переименовать,
                  покрасить или удалить — можно менять только базовые права.
                </div>
              ) : (
                <>
                  <div className="mb-5">
                    <FieldLabel>Название роли</FieldLabel>
                    <TextInput
                      value={draft.name}
                      maxLength={64}
                      disabled={!isEditable}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, name: event.target.value } : current
                        )
                      }
                      placeholder="Например: Модератор"
                    />
                  </div>

                  <div className="mb-6">
                    <FieldLabel>Цвет роли</FieldLabel>
                    <RoleColorPicker
                      value={draft.color}
                      disabled={!isEditable}
                      onChange={(color) =>
                        setDraft((current) => (current ? { ...current, color } : current))
                      }
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Цвет высшей роли участника используется для его имени в списке и в чате.
                    </p>
                  </div>
                </>
              )}

              <div className="mb-6">
                <FieldLabel>Права роли</FieldLabel>
                <RolePermissionEditor
                  catalog={catalog}
                  value={draft.permissions}
                  ownPermissions={isOwner ? catalog.all : ownPermissions}
                  disabled={!isEditable}
                  onChange={(permissions) =>
                    setDraft((current) => (current ? { ...current, permissions } : current))
                  }
                />
              </div>

              {isEditable && !selectedRole.is_default && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDeleteError('')
                    setPendingDelete(selectedRole)
                  }}
                  className="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Удалить роль
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить роль"
        description={
          <>
            Удалить роль <strong>«{pendingDelete?.name}»</strong>? Она будет снята со всех
            участников, и восстановить её будет нельзя.
          </>
        }
        confirmLabel="Удалить роль"
        pendingLabel="Удаление..."
        isPending={isDeleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </TabShell>
  )
}



