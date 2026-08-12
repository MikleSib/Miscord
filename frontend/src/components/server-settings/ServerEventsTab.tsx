'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, MapPin, Pencil, Plus, Radio, Trash2, Users } from 'lucide-react'

import type { Server } from '../../types'
import { Permissions } from '../../lib/permissions'
import { useServerPermissions } from '../../lib/serverPermissions'
import { serverFeatureService, type ScheduledEventState } from '../../services/serverFeatureService'
import { Button } from '../ui/button'
import { EmptyState, ErrorBanner, FieldLabel, Section, TabShell, TextInput } from './layout'

type EventDraft = {
  name: string
  description: string
  entity_type: 'voice' | 'external'
  channel_id: string
  location: string
  scheduled_start_at: string
  scheduled_end_at: string
}

const emptyDraft = (): EventDraft => ({
  name: '', description: '', entity_type: 'voice', channel_id: '', location: '',
  scheduled_start_at: '', scheduled_end_at: '',
})

const localDate = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 16) : ''

const eventDraft = (item: ScheduledEventState): EventDraft => ({
  name: item.name,
  description: item.description || '',
  entity_type: item.entity_type,
  channel_id: item.channel_id ? String(item.channel_id) : '',
  location: item.location || '',
  scheduled_start_at: localDate(item.scheduled_start_at),
  scheduled_end_at: localDate(item.scheduled_end_at),
})

const requestBody = (draft: EventDraft) => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  entity_type: draft.entity_type,
  channel_id: draft.entity_type === 'voice' ? Number(draft.channel_id) : null,
  location: draft.entity_type === 'external' ? draft.location.trim() : null,
  scheduled_start_at: new Date(draft.scheduled_start_at).toISOString(),
  scheduled_end_at: draft.scheduled_end_at ? new Date(draft.scheduled_end_at).toISOString() : null,
})

function EventEditor({
  draft, busy, voiceChannels, onChange, onCancel, onSave,
}: {
  draft: EventDraft
  busy: boolean
  voiceChannels: Server['channels']
  onChange: (next: EventDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const valid = draft.name.trim() && draft.scheduled_start_at
    && (draft.entity_type === 'voice' ? draft.channel_id : draft.location.trim())
  return (
    <Section className="rounded-lg border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label><FieldLabel>Название</FieldLabel><TextInput value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
        <label><FieldLabel>Формат</FieldLabel><select className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm" value={draft.entity_type} onChange={(event) => onChange({ ...draft, entity_type: event.target.value as EventDraft['entity_type'] })}><option value="voice">Голосовой канал</option><option value="external">Внешнее место</option></select></label>
        <label className="sm:col-span-2"><FieldLabel>Описание</FieldLabel><textarea className="min-h-20 w-full resize-y rounded-md border border-border bg-secondary p-3 text-sm" value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} /></label>
        {draft.entity_type === 'voice' ? (
          <label><FieldLabel>Канал</FieldLabel><select className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm" value={draft.channel_id} onChange={(event) => onChange({ ...draft, channel_id: event.target.value })}><option value="">Выберите канал</option>{voiceChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
        ) : (
          <label><FieldLabel>Место или ссылка</FieldLabel><TextInput value={draft.location} onChange={(event) => onChange({ ...draft, location: event.target.value })} /></label>
        )}
        <label><FieldLabel>Начало</FieldLabel><TextInput type="datetime-local" value={draft.scheduled_start_at} onChange={(event) => onChange({ ...draft, scheduled_start_at: event.target.value })} /></label>
        <label><FieldLabel>Завершение (необязательно)</FieldLabel><TextInput type="datetime-local" value={draft.scheduled_end_at} onChange={(event) => onChange({ ...draft, scheduled_end_at: event.target.value })} /></label>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Отмена</Button><Button disabled={busy || !valid} onClick={onSave}>{busy ? 'Сохраняем…' : 'Сохранить событие'}</Button></div>
    </Section>
  )
}

export function ServerEventsTab({ server }: { server: Server }) {
  const [events, setEvents] = useState<ScheduledEventState[]>([])
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<EventDraft>(emptyDraft)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { can } = useServerPermissions(server.id)
  const canCreate = can(Permissions.CREATE_EVENTS) || can(Permissions.MANAGE_EVENTS)
  const voiceChannels = useMemo(() => server.channels.filter((channel) => channel.type === 'voice'), [server.channels])

  const load = () => serverFeatureService.events(server.id).then(setEvents).catch(() => setError('Не удалось загрузить события.'))
  useEffect(() => { void load() }, [server.id])

  const closeEditor = () => { setEditingId(null); setDraft(emptyDraft()) }
  const save = async () => {
    setBusy(true); setError('')
    try {
      const item = editingId === 'new'
        ? await serverFeatureService.createEvent(server.id, requestBody(draft))
        : await serverFeatureService.updateEvent(editingId as number, requestBody(draft))
      setEvents((current) => [...current.filter((row) => row.id !== item.id), item]
        .sort((a, b) => a.scheduled_start_at.localeCompare(b.scheduled_start_at)))
      closeEditor()
    } catch (requestError: any) {
      setError(requestError.response?.data?.detail || 'Не удалось сохранить событие.')
    } finally { setBusy(false) }
  }

  return (
    <TabShell>
      <ErrorBanner message={error} />
      <div className="mb-5 flex items-start justify-between gap-4">
        <div><h2 className="text-lg font-semibold">Запланированные события</h2><p className="mt-1 text-sm text-muted-foreground">Участники могут отметить интерес и вернуться к событию в назначенное время.</p></div>
        {canCreate && <Button onClick={() => { setEditingId('new'); setDraft(emptyDraft()) }}><Plus className="mr-2 h-4 w-4" />Создать</Button>}
      </div>
      {editingId !== null && <EventEditor draft={draft} busy={busy} voiceChannels={voiceChannels} onChange={setDraft} onCancel={closeEditor} onSave={() => void save()} />}
      {!events.length && editingId === null ? (
        <EmptyState icon={CalendarDays} title="Событий пока нет" description="Запланируйте голосовую встречу, турнир или внешний эфир." />
      ) : (
        <div className="space-y-3">{events.map((item) => (
          <article key={item.id} className="rounded-lg border border-border bg-secondary/35 p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-primary/15 text-primary">{item.entity_type === 'voice' ? <Radio className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}</div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{item.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{new Date(item.scheduled_start_at).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}{item.location ? ` · ${item.location}` : ''}</p>
                {item.description && <p className="mt-2 text-sm leading-6">{item.description}</p>}
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{item.interested_count} заинтересованы</p>
                <Button variant={item.interested ? 'secondary' : 'outline'} size="sm" className="mt-3" onClick={() => { const next = !item.interested; setEvents((rows) => rows.map((row) => row.id === item.id ? { ...row, interested: next, interested_count: Math.max(0, row.interested_count + (next ? 1 : -1)) } : row)); void serverFeatureService.setInterest(item.id, next).catch(() => void load()) }}>{item.interested ? 'Заинтересован' : 'Интересно'}</Button>
              </div>
              {canCreate && <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => { setEditingId(item.id); setDraft(eventDraft(item)) }} aria-label="Редактировать событие"><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => void serverFeatureService.cancelEvent(item.id).then(() => setEvents((rows) => rows.filter((row) => row.id !== item.id)))} aria-label="Отменить событие"><Trash2 className="h-4 w-4" /></Button></div>}
            </div>
          </article>
        ))}</div>
      )}
    </TabShell>
  )
}
