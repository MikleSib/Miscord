'use client'

import { useEffect, useState } from 'react'
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'

import type { Server } from '../../types'
import { serverFeatureService, type AutoModRuleState } from '../../services/serverFeatureService'
import { Button } from '../ui/button'
import { EmptyState, ErrorBanner, FieldLabel, TabShell, TextInput, Toggle } from './layout'

type Trigger = AutoModRuleState['trigger_type']
type Action = 'block_message' | 'alert' | 'timeout'
type Draft = { name: string; trigger: Trigger; value: string; action: Action; duration: string }

const TRIGGER_LABEL: Record<Trigger, string> = {
  keyword: 'Ключевые слова', spam: 'Повторяющийся спам',
  mention_spam: 'Лимит упоминаний', link: 'Запрет ссылок',
}

function configFor(trigger: Trigger, value: string) {
  if (trigger === 'keyword') return { keywords: value.split(',').map((item) => item.trim()).filter(Boolean) }
  if (trigger === 'mention_spam') return { max_mentions: Math.max(1, Number(value) || 5) }
  if (trigger === 'link') return { allow_links: false }
  return {}
}

export function ServerAutoModTab({ server }: { server: Server }) {
  const [rules, setRules] = useState<AutoModRuleState[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void serverFeatureService.automod(server.id).then(setRules).catch(() => setError('Не удалось загрузить AutoMod.'))
  }, [server.id])

  const create = async () => {
    if (!draft) return
    setBusy(true); setError('')
    try {
      const actions: { type: string; duration_seconds?: number }[] = [{ type: 'block_message' }]
      if (draft.action === 'alert') actions.push({ type: 'alert' })
      if (draft.action === 'timeout') actions.push({
        type: 'timeout', duration_seconds: Math.max(60, Math.min(2_419_200, Number(draft.duration) * 60 || 600)),
      })
      const rule = await serverFeatureService.createAutoMod(server.id, {
        name: draft.name, enabled: true, trigger_type: draft.trigger,
        config: configFor(draft.trigger, draft.value), actions,
      })
      setRules((items) => [...items, rule]); setDraft(null)
    } catch (requestError: any) {
      setError(requestError.response?.data?.detail || 'Не удалось создать правило.')
    } finally { setBusy(false) }
  }

  const toggle = async (rule: AutoModRuleState, enabled: boolean) => {
    setRules((items) => items.map((item) => item.id === rule.id ? { ...item, enabled } : item))
    try { await serverFeatureService.updateAutoMod(server.id, rule.id, { ...rule, enabled }) }
    catch { setRules((items) => items.map((item) => item.id === rule.id ? rule : item)) }
  }

  return (
    <TabShell>
      <ErrorBanner message={error} />
      <div className="mb-5 flex items-start justify-between gap-4">
        <div><h2 className="text-lg font-semibold">AutoMod</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Правила срабатывают на сервере до сохранения сообщения. Нарушение можно отправить модераторам или автоматически выдать таймаут.</p></div>
        <Button onClick={() => setDraft({ name: '', trigger: 'keyword', value: '', action: 'block_message', duration: '10' })}><Plus className="mr-2 h-4 w-4" />Правило</Button>
      </div>
      {draft && <div className="mb-5 rounded-lg border border-border p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label><FieldLabel>Название</FieldLabel><TextInput value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Например: Запрещённые слова" /></label>
          <label><FieldLabel>Условие</FieldLabel><select className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm" value={draft.trigger} onChange={(event) => setDraft({ ...draft, trigger: event.target.value as Trigger, value: '' })}><option value="keyword">Ключевые слова</option><option value="spam">Повторяющийся спам</option><option value="mention_spam">Много упоминаний</option><option value="link">Любая ссылка</option></select></label>
          {draft.trigger === 'keyword' && <label className="sm:col-span-2"><FieldLabel>Слова через запятую</FieldLabel><TextInput value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>}
          {draft.trigger === 'mention_spam' && <label><FieldLabel>Максимум упоминаний</FieldLabel><TextInput type="number" min={1} max={50} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>}
          <label><FieldLabel>Дополнительное действие</FieldLabel><select className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm" value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value as Action })}><option value="block_message">Только заблокировать</option><option value="alert">Добавить жалобу</option><option value="timeout">Выдать таймаут</option></select></label>
          {draft.action === 'timeout' && <label><FieldLabel>Таймаут, минут</FieldLabel><TextInput type="number" min={1} max={40320} value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: event.target.value })} /></label>}
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDraft(null)}>Отмена</Button><Button disabled={busy || !draft.name || (draft.trigger === 'keyword' && !draft.value)} onClick={() => void create()}>{busy ? 'Создаём…' : 'Создать правило'}</Button></div>
      </div>}
      {!rules.length ? <EmptyState icon={ShieldCheck} title="Правил пока нет" description="Добавьте фильтр слов, ссылок, упоминаний или спама." /> : <div className="space-y-3">{rules.map((rule) => <div key={rule.id} className="flex items-center gap-3 rounded-lg border border-border p-4"><div className="min-w-0 flex-1"><p className="font-medium">{rule.name}</p><p className="mt-1 text-xs text-muted-foreground">{TRIGGER_LABEL[rule.trigger_type]} · {rule.actions.map((action) => ({ block_message: 'блокировка', alert: 'жалоба', timeout: 'таймаут' })[String(action.type)] || action.type).join(', ')}</p></div><Toggle checked={rule.enabled} onChange={(enabled) => void toggle(rule, enabled)} label={rule.enabled ? 'Включено' : 'Выключено'} /><Button variant="ghost" size="sm" className="text-destructive" onClick={() => void serverFeatureService.deleteAutoMod(server.id, rule.id).then(() => setRules((items) => items.filter((item) => item.id !== rule.id)))} aria-label="Удалить правило"><Trash2 className="h-4 w-4" /></Button></div>)}</div>}
    </TabShell>
  )
}
