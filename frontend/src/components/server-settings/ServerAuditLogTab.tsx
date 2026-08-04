'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Loader2, ScrollText } from 'lucide-react'

import { Button } from '../ui/button'
import { UserAvatar } from '../ui/user-avatar'
import serverService from '../../services/serverService'
import { AuditLogEntry, Server } from '../../types'
import { AUDIT_ACTION_LABELS, auditIcon, describeAudit } from './auditText'
import { EmptyState, ErrorBanner, TabShell } from './layout'

interface ServerAuditLogTabProps {
  server: Server
}

const PAGE_SIZE = 50

export function ServerAuditLogTab({ server }: ServerAuditLogTabProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [actionFilter, setActionFilter] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(
    async (action: string) => {
      setIsLoading(true)
      setError('')
      try {
        const response = await serverService.getAuditLogs(server.id, {
          limit: PAGE_SIZE,
          action: action || undefined,
        })
        setEntries(response.entries)
        setHasMore(response.has_more)
      } catch (loadError: any) {
        console.error('Ошибка загрузки журнала аудита:', loadError)
        setError(loadError.response?.data?.detail || 'Не удалось загрузить журнал аудита')
      } finally {
        setIsLoading(false)
      }
    },
    [server.id]
  )

  useEffect(() => {
    void load(actionFilter)
  }, [load, actionFilter])

  const handleLoadMore = async () => {
    const last = entries[entries.length - 1]
    if (!last) return

    setIsLoadingMore(true)
    setError('')
    try {
      const response = await serverService.getAuditLogs(server.id, {
        limit: PAGE_SIZE,
        before: last.id,
        action: actionFilter || undefined,
      })
      setEntries((current) => [...current, ...response.entries])
      setHasMore(response.has_more)
    } catch (loadError: any) {
      console.error('Ошибка загрузки журнала аудита:', loadError)
      setError(loadError.response?.data?.detail || 'Не удалось загрузить больше записей')
    } finally {
      setIsLoadingMore(false)
    }
  }

  return (
    <TabShell>
      <ErrorBanner message={error} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-muted-foreground">
          История изменений сервера. Записи хранятся с момента включения журнала.
        </p>
        <select
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value)}
          className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Все действия</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([action, label]) => (
            <option key={action} value={action}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Загружаем журнал...
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="Записей нет"
          description={
            actionFilter
              ? 'По выбранному фильтру ничего не найдено.'
              : 'Как только на сервере что-то изменится, событие появится здесь.'
          }
        />
      ) : (
        <>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {entries.map((entry) => {
              const Icon = auditIcon(entry.action)
              return (
                <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="relative flex-none">
                    <UserAvatar user={(entry.actor || undefined) as any} size={36} />
                    <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background">
                      <Icon className="h-2.5 w-2.5 text-muted-foreground" />
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{describeAudit(entry)}</p>
                    {entry.reason && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Причина: {entry.reason}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatAuditDate(entry.created_at)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Загружаем...
                  </>
                ) : (
                  'Показать ещё'
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </TabShell>
  )
}

function formatAuditDate(value?: string | null): string {
  if (!value) return 'Дата неизвестна'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Дата неизвестна'
  return format(parsed, 'd MMMM yyyy, HH:mm', { locale: ru })
}
