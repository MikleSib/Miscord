'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Link2, Loader2, Plus, Trash2 } from 'lucide-react'

import { Button } from '../ui/button'
import serverService from '../../services/serverService'
import websocketService from '../../services/websocketService'
import { useAuthStore } from '../../store/store'
import { Permissions } from '../../lib/permissions'
import { useServerPermissions } from '../../lib/serverPermissions'
import { Server, ServerInvite } from '../../types'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState, ErrorBanner, FieldLabel, TabShell } from './layout'

interface ServerInvitesTabProps {
  server: Server
}

const EXPIRY_OPTIONS = [
  { label: '30 минут', value: 30 * 60 },
  { label: '1 час', value: 60 * 60 },
  { label: '6 часов', value: 6 * 60 * 60 },
  { label: '1 день', value: 24 * 60 * 60 },
  { label: '7 дней', value: 7 * 24 * 60 * 60 },
  { label: 'Никогда', value: 0 },
]

const USES_OPTIONS = [
  { label: 'Без ограничений', value: 0 },
  { label: '1 использование', value: 1 },
  { label: '5 использований', value: 5 },
  { label: '10 использований', value: 10 },
  { label: '25 использований', value: 25 },
  { label: '50 использований', value: 50 },
]

export function ServerInvitesTab({ server }: ServerInvitesTabProps) {
  const currentUser = useAuthStore((state) => state.user)
  const { can } = useServerPermissions(server.id)
  const canCreate = can(Permissions.CREATE_INVITE)
  const canManageAll = can(Permissions.MANAGE_INVITES)

  const [invites, setInvites] = useState<ServerInvite[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const [maxAge, setMaxAge] = useState<number>(24 * 60 * 60)
  const [maxUses, setMaxUses] = useState<number>(0)
  const [isCreating, setIsCreating] = useState(false)

  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ServerInvite | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const response = await serverService.getInvites(server.id)
      setInvites(response.invites)
    } catch (loadError: any) {
      console.error('Ошибка загрузки приглашений:', loadError)
      setError(loadError.response?.data?.detail || 'Не удалось загрузить приглашения')
    } finally {
      setIsLoading(false)
    }
  }, [server.id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const reload = (payload: any) => {
      const serverId = payload?.data?.server_id ?? payload?.server_id
      if (serverId === server.id) {
        void load()
      }
    }
    const events = ['server_invite_created', 'server_invite_deleted']
    events.forEach((event) => websocketService.on(event, reload))
    return () => {
      events.forEach((event) => websocketService.off(event, reload))
    }
  }, [server.id, load])

  const buildInviteLink = (code: string) =>
    typeof window === 'undefined' ? `/invite/${code}` : `${window.location.origin}/invite/${code}`

  const handleCopy = async (code: string) => {
    const link = buildInviteLink(code)
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // Clipboard API недоступен (например, без HTTPS) — старый способ
      const textarea = document.createElement('textarea')
      textarea.value = link
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopiedCode(code)
    setTimeout(() => setCopiedCode((current) => (current === code ? null : current)), 2000)
  }

  const handleCreate = async () => {
    setIsCreating(true)
    setError('')
    try {
      const invite = await serverService.createInvite(server.id, {
        max_age_seconds: maxAge || null,
        max_uses: maxUses || null,
        unique: true,
      })
      setInvites((current) => [invite, ...current])
      void handleCopy(invite.code)
    } catch (createError: any) {
      console.error('Ошибка создания приглашения:', createError)
      setError(createError.response?.data?.detail || 'Не удалось создать приглашение')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return

    setIsDeleting(true)
    setDeleteError('')
    try {
      await serverService.deleteInvite(pendingDelete.code)
      setInvites((current) => current.filter((invite) => invite.code !== pendingDelete.code))
      setPendingDelete(null)
    } catch (deleteFailure: any) {
      console.error('Ошибка отзыва приглашения:', deleteFailure)
      setDeleteError(deleteFailure.response?.data?.detail || 'Не удалось отозвать приглашение')
    } finally {
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <TabShell>
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Загружаем приглашения...
        </div>
      </TabShell>
    )
  }

  return (
    <TabShell>
      <ErrorBanner message={error} />

      {canCreate && (
        <div className="mb-6 rounded-lg border border-border bg-secondary/40 p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Создайте ссылку-приглашение и отправьте её другу. По ссылке он присоединится к серверу.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <FieldLabel>Срок действия</FieldLabel>
              <select
                value={maxAge}
                onChange={(event) => setMaxAge(Number(event.target.value))}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[180px] flex-1">
              <FieldLabel>Максимум использований</FieldLabel>
              <select
                value={maxUses}
                onChange={(event) => setMaxUses(Number(event.target.value))}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {USES_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <Button onClick={handleCreate} disabled={isCreating} className="flex-none">
              {isCreating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Создать ссылку
            </Button>
          </div>
        </div>
      )}

      {invites.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="Активных приглашений нет"
          description={
            canCreate
              ? 'Создайте ссылку выше, и она появится в этом списке.'
              : 'У вас нет права создавать приглашения на этом сервере.'
          }
        />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {invites.map((invite) => {
            const canDelete = canManageAll || invite.inviter_id === currentUser?.id
            const isCopied = copiedCode === invite.code

            return (
              <div key={invite.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-secondary px-2 py-0.5 font-mono text-sm">
                      {invite.code}
                    </code>
                    {invite.is_expired && (
                      <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-400">
                        Недействительно
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {invite.inviter ? `Создал ${invite.inviter.username}` : 'Автор неизвестен'}
                    {' · '}
                    {describeUses(invite)}
                    {' · '}
                    {describeExpiry(invite)}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="flex-none"
                  onClick={() => handleCopy(invite.code)}
                >
                  {isCopied ? (
                    <>
                      <Check className="mr-2 h-4 w-4 text-green-500" />
                      Скопировано
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Копировать
                    </>
                  )}
                </Button>

                {canDelete && (
                  <button
                    type="button"
                    aria-label="Отозвать приглашение"
                    title="Отозвать приглашение"
                    onClick={() => {
                      setDeleteError('')
                      setPendingDelete(invite)
                    }}
                    className="flex-none rounded p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Отозвать приглашение"
        description={
          <>
            Отозвать приглашение <code>{pendingDelete?.code}</code>? Ссылка перестанет работать
            сразу.
          </>
        }
        confirmLabel="Отозвать"
        pendingLabel="Отзываем..."
        isPending={isDeleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </TabShell>
  )
}

function describeUses(invite: ServerInvite): string {
  if (!invite.max_uses) return `Использовано ${invite.uses} раз`
  return `Использовано ${invite.uses} из ${invite.max_uses}`
}

function describeExpiry(invite: ServerInvite): string {
  if (!invite.expires_at) return 'Бессрочно'

  const expires = new Date(invite.expires_at)
  if (Number.isNaN(expires.getTime())) return 'Срок неизвестен'

  const diffMs = expires.getTime() - Date.now()
  if (diffMs <= 0) return 'Срок истёк'

  const minutes = Math.round(diffMs / 60000)
  if (minutes < 60) return `Осталось ${minutes} мин`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Осталось ${hours} ч`

  return `Осталось ${Math.round(hours / 24)} дн`
}

