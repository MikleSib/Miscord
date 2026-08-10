'use client'

import { ChevronLeft, ChevronRight, Hash, Import, Loader2, MessageSquare as MessageSquareText, Mic2, Shield, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { communityApi } from '../../services/communityApi'
import type { ServerTemplatePreview, ServerTemplateSummary } from '../../types/community'
import { Modal } from '../ui/modal'
import { ServerImportWizard } from './ServerImportWizard'

const ICONS = [Hash, MessageSquareText, Mic2, Shield]

export function ServerTemplateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (serverId: number) => Promise<void> }) {
  const [templates, setTemplates] = useState<ServerTemplateSummary[]>([])
  const [selected, setSelected] = useState<ServerTemplateSummary | null>(null)
  const [preview, setPreview] = useState<ServerTemplatePreview | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected(null); setPreview(null); setName(''); setError(''); setImporting(false); setLoading(true)
    void communityApi.listTemplates().then((data) => setTemplates([...data.builtins, ...data.mine])).catch(() => setError('Не удалось загрузить шаблоны')).finally(() => setLoading(false))
  }, [open])

  const choose = async (template: ServerTemplateSummary) => {
    setSelected(template); setName(template.name); setLoading(true); setError('')
    try { setPreview(await communityApi.previewTemplate(template.id)) }
    catch { setError('Не удалось открыть структуру шаблона') }
    finally { setLoading(false) }
  }

  const create = async () => {
    if (!selected || !name.trim()) return
    setLoading(true); setError('')
    try {
      const result: any = await communityApi.createServerFromTemplate(selected.id, { name: name.trim() })
      await onCreated(Number(result.id)); onClose()
    } catch (reason: any) { setError(reason?.response?.data?.detail || 'Не удалось создать сервер') }
    finally { setLoading(false) }
  }

  const grouped = useMemo(() => ({ builtins: templates.filter((item) => item.kind === 'builtin'), mine: templates.filter((item) => item.kind === 'user') }), [templates])

  return (
    <Modal open={open} onClose={onClose} title="Создать сервер" contentClassName="community-template-modal max-w-3xl bg-background">
      {importing ? <ServerImportWizard onBack={() => setImporting(false)} onCreated={async (serverId) => { await onCreated(serverId); onClose() }} /> :
      <div className="community-template-modal__body flex min-h-[560px] flex-col p-5">
        <header className="flex items-start justify-between gap-3"><div>{selected && <button type="button" onClick={() => { setSelected(null); setPreview(null) }} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-[#aab1ff]"><ChevronLeft className="h-4 w-4" /> К шаблонам</button>}<h2 className="text-2xl font-bold">{selected ? selected.name : 'Начните с готовой структуры'}</h2><p className="mt-1 max-w-xl text-sm leading-6 text-text-quiet">{selected ? selected.description : 'Категории, каналы, роли и настройки форума будут созданы одной транзакцией.'}</p></div><button type="button" onClick={onClose} aria-label="Закрыть" className="rounded p-1 text-text-quiet hover:bg-surface"><X className="h-5 w-5" /></button></header>
        {error && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        {loading && !templates.length ? <Loader2 className="m-auto h-7 w-7 animate-spin text-primary" /> : !selected ? (
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-quiet">Встроенные</h3>
            <button type="button" onClick={() => setImporting(true)} className="community-template-card mb-4 flex w-full items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-left transition hover:border-primary/70 hover:bg-primary/10"><span className="community-template-card__icon flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary"><Import className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block font-semibold">Перенести существующий сервер</span><span className="community-template-card__description mt-0.5 block text-sm text-text-quiet">Импорт ролей, категорий, каналов, Forum и прав доступа.</span></span><ChevronRight className="h-5 w-5 text-text-quiet" /></button>
            <div className="space-y-2">{grouped.builtins.map((template, index) => { const Icon = ICONS[index % ICONS.length]; return <button key={template.id} type="button" onClick={() => void choose(template)} className="community-template-card group flex w-full items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:border-primary/60 hover:bg-surface-raised"><span className="community-template-card__icon flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-xl text-primary">{template.icon || <Icon className="h-5 w-5" />}</span><span className="min-w-0 flex-1"><span className="block font-semibold">{template.name}</span><span className="community-template-card__description mt-0.5 block text-sm text-text-quiet">{template.description}</span></span><ChevronRight className="h-5 w-5 text-text-quiet group-hover:text-foreground" /></button> })}</div>
            {grouped.mine.length > 0 && <><h3 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-text-quiet">Мои шаблоны</h3><div className="space-y-2">{grouped.mine.map((template) => <button key={template.id} type="button" onClick={() => void choose(template)} className="flex w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-left hover:bg-surface"><span className="w-5 text-center">{template.icon || <Shield className="h-5 w-5 text-text-quiet" />}</span><span className="min-w-0 flex-1"><span className="font-medium">{template.name}</span><span className="ml-2 text-xs text-text-quiet">приватный</span></span><ChevronRight className="h-4 w-4" /></button>)}</div></>}
          </div>
        ) : (
          <div className="mt-6 flex min-h-0 flex-1 flex-col gap-5 sm:flex-row">
            <div className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-border bg-surface p-4"><h3 className="text-xs font-bold uppercase tracking-wide text-text-quiet">Структура</h3>{preview?.categories.map((category) => <section key={category.key} className="mt-4"><h4 className="text-xs font-semibold uppercase text-text-quiet">{category.name}</h4><div className="mt-1 space-y-1">{preview.channels.filter((channel) => channel.category_key === category.key).map((channel) => <div key={channel.key} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-text-body">{channel.type === 'voice' ? <Mic2 className="h-4 w-4" /> : channel.type === 'forum' ? <MessageSquareText className="h-4 w-4" /> : <Hash className="h-4 w-4" />}{channel.name}</div>)}</div></section>)}{preview?.channels.filter((channel) => !channel.category_key).map((channel) => <div key={channel.key} className="mt-3 flex items-center gap-2 text-sm"><Hash className="h-4 w-4" />{channel.name}</div>)}</div>
            <div className="w-full sm:w-64"><label htmlFor="template-server-name" className="text-xs font-bold uppercase tracking-wide text-text-quiet">Название сервера</label><input id="template-server-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3 outline-none focus:ring-2 focus:ring-primary" /><p className="mt-4 text-xs leading-5 text-text-quiet">Участники, сообщения, боты, webhooks и секреты не копируются.</p><button type="button" onClick={() => void create()} disabled={!name.trim() || loading} className="mt-5 h-10 w-full rounded-md bg-primary text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50">{loading ? 'Создание…' : 'Создать сервер'}</button></div>
          </div>
        )}
      </div>}
    </Modal>
  )
}
