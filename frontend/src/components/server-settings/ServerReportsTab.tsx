'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, Flag, Loader2, XCircle } from 'lucide-react'

import type { Server } from '../../types'
import { safetyService, type SafetyReportState } from '../../services/safetyService'
import { Button } from '../ui/button'
import { EmptyState, ErrorBanner, TabShell } from './layout'

const CATEGORY: Record<SafetyReportState['category'], string> = {
  spam: 'Спам', harassment: 'Травля', hate: 'Язык ненависти', sexual: 'Нежелательный контент',
  violence: 'Насилие', impersonation: 'Выдача себя за другого', other: 'Другое',
}

export function ServerReportsTab({ server }: { server: Server }) {
  const [status, setStatus] = useState<'open' | 'reviewing' | 'resolved' | 'dismissed' | 'all'>('open')
  const [reports, setReports] = useState<SafetyReportState[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true); setError('')
    try { setReports(await safetyService.serverReports(server.id, status)) }
    catch (requestError: any) { setError(requestError.response?.data?.detail || 'Не удалось загрузить жалобы.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [server.id, status])

  const update = async (report: SafetyReportState, next: SafetyReportState['status']) => {
    setBusy(report.id); setError('')
    try {
      const resolution = next === 'dismissed' ? 'Нарушение не подтверждено' : next === 'resolved' ? 'Рассмотрено модератором' : undefined
      const updated = await safetyService.resolveReport(server.id, report.id, next, resolution)
      setReports((items) => status === 'all' || status === next ? items.map((item) => item.id === updated.id ? updated : item) : items.filter((item) => item.id !== report.id))
    } catch (requestError: any) { setError(requestError.response?.data?.detail || 'Не удалось обновить жалобу.') }
    finally { setBusy(null) }
  }

  return (
    <TabShell>
      <div className="mb-5"><h2 className="text-lg font-semibold">Жалобы участников</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Очередь доступна только модераторам. Проверяйте контекст сообщения до применения санкций.</p></div>
      <ErrorBanner message={error} />
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Статус жалоб">
        {(['open', 'reviewing', 'resolved', 'dismissed', 'all'] as const).map((value) => <Button key={value} size="sm" variant={status === value ? 'default' : 'outline'} onClick={() => setStatus(value)}>{({ open: 'Новые', reviewing: 'В работе', resolved: 'Решённые', dismissed: 'Отклонённые', all: 'Все' })[value]}</Button>)}
      </div>
      {loading ? <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка…</p> : !reports.length ? <EmptyState icon={Flag} title="Здесь пока пусто" description="Жалобы с выбранным статусом появятся в этой очереди." /> : <div className="space-y-3">{reports.map((report) => <article key={report.id} className="rounded-lg border border-border bg-secondary/30 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{CATEGORY[report.category]}</p><p className="mt-1 text-xs text-muted-foreground">#{report.id} · {new Date(report.created_at).toLocaleString('ru-RU')}</p></div><span className="rounded-full bg-background px-2.5 py-1 text-xs text-muted-foreground">{report.status}</span></div><p className="mt-3 text-sm">От: <strong>{report.reporter?.display_name || report.reporter?.username || 'удалённый пользователь'}</strong>{report.target && <> · На: <strong>{report.target.display_name || report.target.username}</strong></>}</p>{report.details && <p className="mt-3 whitespace-pre-wrap rounded-md bg-background/65 p-3 text-sm leading-6">{report.details}</p>}<p className="mt-3 text-xs text-muted-foreground">{report.message_id ? `Сообщение #${report.message_id}` : report.channel_id ? `Канал #${report.channel_id}` : 'Жалоба на пользователя'}</p><div className="mt-4 flex flex-wrap justify-end gap-2">{report.status === 'open' && <Button size="sm" variant="outline" disabled={busy === report.id} onClick={() => void update(report, 'reviewing')}><Eye className="mr-2 h-4 w-4" />Взять в работу</Button>}{!['resolved', 'dismissed'].includes(report.status) && <><Button size="sm" variant="outline" disabled={busy === report.id} onClick={() => void update(report, 'dismissed')}><XCircle className="mr-2 h-4 w-4" />Отклонить</Button><Button size="sm" disabled={busy === report.id} onClick={() => void update(report, 'resolved')}><CheckCircle2 className="mr-2 h-4 w-4" />Решено</Button></>}</div></article>)}</div>}
    </TabShell>
  )
}
