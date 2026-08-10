'use client'

import { Check, CopyPlus, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { communityApi } from '../../services/communityApi'
import type { Server } from '../../types'
import type { ServerTemplateSummary } from '../../types/community'

export function ServerTemplatesTab({ server }: { server: Server }) {
  const [items, setItems] = useState<ServerTemplateSummary[]>([])
  const [name, setName] = useState(`${server.name} — шаблон`)
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('🧩')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editIcon, setEditIcon] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try { setItems((await communityApi.listTemplates()).mine) }
    catch { setError('Не удалось загрузить шаблоны') }
  }
  useEffect(() => { void load() }, [server.id])

  const save = async () => {
    if (!name.trim()) return
    setLoading(true); setError('')
    try { await communityApi.saveServerTemplate({ source_server_id: server.id, name: name.trim(), description: description.trim() || null, icon: icon.trim() || null }); await load() }
    catch (reason: any) { setError(reason?.response?.data?.detail || 'Не удалось сохранить шаблон') }
    finally { setLoading(false) }
  }

  const remove = async (id: string) => {
    await communityApi.deleteServerTemplate(id)
    setItems((current) => current.filter((item) => item.id !== id))
  }

  const beginEdit = (item: ServerTemplateSummary) => {
    setEditingId(item.id)
    setEditName(item.name)
    setEditDescription(item.description || '')
    setEditIcon(item.icon || '')
  }

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return
    setLoading(true)
    try {
      await communityApi.updateServerTemplate(editingId, { name: editName.trim(), description: editDescription.trim() || null, icon: editIcon.trim() || null })
      setEditingId(null)
      await load()
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось обновить шаблон')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <section><h2 className="text-base font-semibold">Приватный шаблон</h2><p className="mt-1 text-sm leading-6 text-text-quiet">Сохраните категории, каналы, форумы, роли и права. Участники, история, боты и секреты не попадут в копию.</p>{error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-red-300">{error}</p>}<div className="mt-4 grid gap-3"><label className="text-xs font-bold uppercase text-text-quiet">Иконка<input value={icon} onChange={(event) => setIcon(event.target.value)} maxLength={32} className="mt-2 h-10 w-24 rounded-md bg-canvas-deep px-3 text-center text-lg font-normal normal-case text-foreground outline-none focus:ring-2 focus:ring-primary" /></label><label className="text-xs font-bold uppercase text-text-quiet">Название<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className="mt-2 h-10 w-full rounded-md bg-canvas-deep px-3 text-sm font-normal normal-case text-foreground outline-none focus:ring-2 focus:ring-primary" /></label><label className="text-xs font-bold uppercase text-text-quiet">Описание<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500} className="mt-2 w-full rounded-md bg-canvas-deep p-3 text-sm font-normal normal-case text-foreground outline-none focus:ring-2 focus:ring-primary" /></label></div><button type="button" onClick={() => void save()} disabled={!name.trim() || loading} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CopyPlus className="h-4 w-4" />} Сохранить шаблон</button></section>
      <section className="border-t border-border pt-5"><h2 className="text-base font-semibold">Мои шаблоны</h2><div className="mt-3 space-y-2">{items.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">{editingId === item.id ? <><input value={editIcon} onChange={(event) => setEditIcon(event.target.value)} maxLength={32} aria-label="Иконка шаблона" className="h-9 w-12 rounded bg-canvas-deep text-center" /><div className="min-w-0 flex-1 space-y-1"><input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={100} aria-label="Название шаблона" className="h-8 w-full rounded bg-canvas-deep px-2 text-sm" /><input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={500} aria-label="Описание шаблона" className="h-8 w-full rounded bg-canvas-deep px-2 text-xs" /></div><button type="button" onClick={() => void saveEdit()} aria-label="Сохранить"><Check className="h-4 w-4" /></button><button type="button" onClick={() => setEditingId(null)} aria-label="Отмена"><X className="h-4 w-4" /></button></> : <><span className="text-xl">{item.icon || '🧩'}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name}</p><p className="truncate text-xs text-text-quiet">{item.description || 'Без описания'}</p></div><button type="button" onClick={() => beginEdit(item)} aria-label={`Изменить ${item.name}`} className="rounded p-2 text-text-quiet hover:bg-canvas-deep hover:text-foreground"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => void remove(item.id)} aria-label={`Удалить ${item.name}`} className="rounded p-2 text-text-quiet hover:bg-destructive/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button></>}</div>)}{items.length === 0 && <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-text-quiet">Сохранённых шаблонов пока нет.</p>}</div></section>
    </div>
  )
}
