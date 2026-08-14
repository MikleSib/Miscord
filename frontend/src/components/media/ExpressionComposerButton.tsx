'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, Search, Shapes, Sticker, X } from 'lucide-react'
import type { MessageGif, ServerExpression } from '../../types'
import expressionService from '../../services/expressionService'
import { useCapabilities } from '../../features/capabilities/capabilities'
import { cn } from '../../lib/utils'

type Tab = 'emoji' | 'sticker' | 'gif'

export function ExpressionComposerButton({
  serverId, disabled, onEmoji, onSticker, onGif,
}: {
  serverId?: number
  disabled?: boolean
  onEmoji: (token: string) => void
  onSticker: (id: number) => void
  onGif: (gif: MessageGif) => void
}) {
  const capabilities = useCapabilities()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('emoji')
  const [items, setItems] = useState<ServerExpression[]>([])
  const [gifs, setGifs] = useState<MessageGif[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const available: Tab[] = [
      ...(capabilities.customEmoji ? ['emoji' as const] : []),
      ...(capabilities.stickers ? ['sticker' as const] : []),
      ...(capabilities.gifs ? ['gif' as const] : []),
    ]
    if (!available.includes(tab) && available[0]) setTab(available[0])
  }, [capabilities.customEmoji, capabilities.gifs, capabilities.stickers, tab])

  useEffect(() => {
    if (!open) return
    const pointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', pointer)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', pointer)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  useEffect(() => {
    if (!open || tab === 'gif') return
    let active = true
    setLoading(true)
    expressionService.list(serverId, tab).then((value) => { if (active) setItems(value) })
      .catch(() => { if (active) setItems([]) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, serverId, tab])

  useEffect(() => {
    if (!open || tab !== 'gif') return
    const timer = window.setTimeout(() => {
      setLoading(true)
      expressionService.searchGiphy(query).then(setGifs).catch(() => setGifs([])).finally(() => setLoading(false))
    }, query ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [open, query, tab])

  const visible = useMemo(() => items.filter((item) => item.name.includes(query.trim().toLowerCase())), [items, query])
  if (!capabilities.customEmoji && !capabilities.stickers && !capabilities.gifs) return null
  const chooseTab = (next: Tab) => { setTab(next); setQuery('') }

  return (
    <div ref={rootRef} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} className="grid h-11 w-11 place-items-center rounded-md text-text-muted transition hover:bg-surface-raised hover:text-white disabled:opacity-50" aria-label="Emoji, GIF и стикеры" title="Emoji, GIF и стикеры">
        <Shapes className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute bottom-[calc(100%+10px)] right-0 z-50 flex h-[390px] w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-2xl" role="dialog" aria-label="Emoji, GIF и стикеры">
          <div className="flex items-center border-b border-border px-2 pt-2">
            {capabilities.customEmoji && <TabButton active={tab === 'emoji'} icon={ImageIcon} label="Emoji" onClick={() => chooseTab('emoji')} />}
            {capabilities.stickers && <TabButton active={tab === 'sticker'} icon={Sticker} label="Стикеры" onClick={() => chooseTab('sticker')} />}
            {capabilities.gifs && <TabButton active={tab === 'gif'} icon={Shapes} label="GIF" onClick={() => chooseTab('gif')} />}
            <button type="button" className="ml-auto grid h-10 w-10 place-items-center rounded-md text-text-quiet hover:bg-white/5 hover:text-white" onClick={() => setOpen(false)} aria-label="Закрыть"><X className="h-4 w-4" /></button>
          </div>
          <label className="m-3 flex items-center gap-2 rounded-md bg-canvas-deep px-3">
            <Search className="h-4 w-4 text-text-quiet" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'gif' ? 'Найти GIF' : 'Найти по имени'} className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" autoFocus />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-0">
            {loading ? <Empty text="Загрузка…" /> : tab === 'gif' ? (
              gifs.length ? <div className="columns-2 gap-2">{gifs.map((gif) => <button key={gif.id} type="button" className="mb-2 block w-full overflow-hidden rounded-lg bg-canvas-deep hover:ring-2 hover:ring-primary" onClick={() => { onGif(gif); setOpen(false) }}><img src={gif.preview_url || gif.url} alt={gif.title || 'GIF'} className="w-full" loading="lazy" /></button>)}</div> : <Empty text="GIF не найдены" />
            ) : visible.length ? (
              <div className={cn('grid gap-2', tab === 'emoji' ? 'grid-cols-6' : 'grid-cols-3')}>
                {visible.map((item) => <button key={item.id} type="button" className="group grid aspect-square place-items-center rounded-lg bg-canvas-deep p-2 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary" title={`:${item.name}:`} onClick={() => { tab === 'emoji' ? onEmoji(`<:${item.name}:${item.id}>`) : onSticker(item.id); setOpen(false) }}><img src={item.file_url} alt={item.name} className="max-h-full max-w-full object-contain transition group-hover:scale-105" loading="lazy" /></button>)}
              </div>
            ) : <Empty text={serverId ? 'На сервере пока ничего нет' : 'Нет общих наборов'} />}
          </div>
          {tab === 'gif' && <div className="border-t border-border px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-text-quiet">Powered by GIPHY</div>}
        </div>
      )}
    </div>
  )
}

function TabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Shapes; label: string; onClick: () => void }) {
  return <button type="button" className={cn('flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-semibold', active ? 'border-primary text-white' : 'border-transparent text-text-muted hover:text-white')} onClick={onClick}><Icon className="h-4 w-4" />{label}</button>
}

function Empty({ text }: { text: string }) { return <div className="grid h-full min-h-40 place-items-center text-sm text-text-quiet">{text}</div> }
