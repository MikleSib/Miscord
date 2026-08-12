'use client'

import { useEffect, useState } from 'react'
import { Bookmark, ExternalLink, Loader2, Trash2 } from 'lucide-react'

import { messageStateService, type SavedMessageState } from '../../services/messageStateService'
import { useStore } from '../../lib/store'
import { previewMessageText } from '../../lib/markdown'
import { UserAvatar } from '../ui/user-avatar'
import { Button } from '../ui/button'


export function SavedMessagesSettings({ onNavigate }: { onNavigate?: () => void }) {
  const [items, setItems] = useState<SavedMessageState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void messageStateService.listSaved()
      .then(setItems)
      .catch(() => setError('Не удалось загрузить сохранённые сообщения.'))
      .finally(() => setLoading(false))
  }, [])

  const open = async (item: SavedMessageState) => {
    const store = useStore.getState()
    await store.selectServer(item.server_id)
    store.selectChannel(item.message.text_channel_id, 'text')
    onNavigate?.()
  }

  return (
    <div className="mx-auto max-w-3xl pb-20">
      <div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary"><Bookmark className="h-5 w-5" /></div><div><h2 className="text-xl font-semibold">Сохранённые сообщения</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Личная коллекция важных сообщений. Она видна только вам.</p></div></div>
      {loading && <p className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка…</p>}
      {error && <p className="mt-6 rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {!loading && !error && items.length === 0 && <div className="mt-10 rounded-xl border border-dashed border-border p-8 text-center"><Bookmark className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-semibold">Пока ничего не сохранено</p><p className="mt-1 text-sm text-muted-foreground">Нажмите значок закладки в меню сообщения.</p></div>}
      <div className="mt-7 space-y-3">{items.map((item) => <article key={item.id} className="rounded-xl border border-border bg-secondary/30 p-4"><div className="flex items-start gap-3"><UserAvatar user={item.message.author} size={38} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-2"><span className="font-semibold">{item.message.author.display_name || item.message.author.username}</span><time className="text-xs text-muted-foreground">{new Date(item.message.timestamp).toLocaleString('ru-RU')}</time></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{previewMessageText(item.message.content, 500) || (item.message.attachments.length ? 'Вложение' : 'Сообщение')}</p>{item.note && <p className="mt-3 rounded-md bg-background/60 px-3 py-2 text-xs text-muted-foreground">Заметка: {item.note}</p>}</div></div><div className="mt-3 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => void open(item)}><ExternalLink className="mr-2 h-4 w-4" />Открыть</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => { setItems((rows) => rows.filter((row) => row.id !== item.id)); void messageStateService.unsaveMessage(item.message.id).catch(() => setItems((rows) => [item, ...rows])) }}><Trash2 className="mr-2 h-4 w-4" />Удалить</Button></div></article>)}</div>
    </div>
  )
}
