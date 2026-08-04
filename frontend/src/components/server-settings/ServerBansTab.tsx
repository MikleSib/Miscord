'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Ban, Loader2, Search, ShieldOff } from 'lucide-react'

import { Button } from '../ui/button'
import { UserAvatar } from '../ui/user-avatar'
import serverService from '../../services/serverService'
import { Server, ServerBan } from '../../types'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState, ErrorBanner, TabShell, TextInput } from './layout'

interface ServerBansTabProps {
  server: Server
}

export function ServerBansTab({ server }: ServerBansTabProps) {
  const [bans, setBans] = useState<ServerBan[]>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const [pendingUnban, setPendingUnban] = useState<ServerBan | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      setBans(await serverService.getBans(server.id))
    } catch (loadError: any) {
      console.error('Ошибка загрузки блокировок:', loadError)
      setError(loadError.response?.data?.detail || 'Не удалось загрузить список блокировок')
    } finally {
      setIsLoading(false)
    }
  }, [server.id])

  useEffect(() => {
    void load()
  }, [load])

  const filteredBans = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return bans
    return bans.filter((ban) =>
      [ban.user?.username, ban.user?.display_name, ban.reason]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  }, [bans, search])

  const handleUnban = async () => {
    if (!pendingUnban) return

    setIsSubmitting(true)
    setActionError('')
    try {
      await serverService.unbanMember(server.id, pendingUnban.user_id)
      setBans((current) => current.filter((ban) => ban.user_id !== pendingUnban.user_id))
      setPendingUnban(null)
    } catch (unbanError: any) {
      console.error('Ошибка снятия блокировки:', unbanError)
      setActionError(unbanError.response?.data?.detail || 'Не удалось снять блокировку')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <TabShell>
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Загружаем блокировки...
        </div>
      </TabShell>
    )
  }

  return (
    <TabShell>
      <ErrorBanner message={error} />

      <p className="mb-4 text-sm text-muted-foreground">
        Заблокированные пользователи не могут вернуться на сервер — ни по приглашению, ни по ссылке.
      </p>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по имени или причине"
            className="pl-9"
          />
        </div>
        <span className="flex-none text-sm text-muted-foreground">{bans.length}</span>
      </div>

      {filteredBans.length === 0 ? (
        <EmptyState
          icon={Ban}
          title={bans.length === 0 ? 'Заблокированных нет' : 'Ничего не найдено'}
          description={
            bans.length === 0
              ? 'Здесь появятся пользователи, которых вы заблокируете на этом сервере.'
              : 'Попробуйте изменить поисковый запрос.'
          }
        />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {filteredBans.map((ban) => (
            <div key={ban.id} className="flex items-start gap-3 px-4 py-3">
              <UserAvatar user={(ban.user || undefined) as any} size={40} />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {ban.user?.display_name || ban.user?.username || `Пользователь #${ban.user_id}`}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {ban.reason ? `Причина: ${ban.reason}` : 'Причина не указана'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {ban.moderator ? `Заблокировал ${ban.moderator.username}` : 'Модератор неизвестен'}
                  {ban.created_at ? ` · ${formatBanDate(ban.created_at)}` : ''}
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="flex-none"
                onClick={() => {
                  setActionError('')
                  setPendingUnban(ban)
                }}
              >
                <ShieldOff className="mr-2 h-4 w-4" />
                Разблокировать
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingUnban !== null}
        danger={false}
        title="Снять блокировку"
        description={
          <>
            Разблокировать{' '}
            <strong>
              {pendingUnban?.user?.display_name ||
                pendingUnban?.user?.username ||
                `пользователя #${pendingUnban?.user_id}`}
            </strong>
            ? После этого он сможет снова присоединиться по приглашению.
          </>
        }
        confirmLabel="Разблокировать"
        pendingLabel="Снимаем..."
        isPending={isSubmitting}
        error={actionError}
        onConfirm={handleUnban}
        onCancel={() => setPendingUnban(null)}
      />
    </TabShell>
  )
}

function formatBanDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return format(parsed, 'd MMMM yyyy', { locale: ru })
}
