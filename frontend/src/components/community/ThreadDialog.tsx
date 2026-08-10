'use client'

import { Lock, MessageCircle, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { communityApi } from '../../services/communityApi'
import { useCommunityStore } from '../../store/communityStore'
import type { Message } from '../../types'
import { Modal } from '../ui/modal'

interface Props {
  open: boolean
  channelId: number
  sourceMessage?: Message | null
  onClose: () => void
}

export function ThreadDialog({ open, channelId, sourceMessage, onClose }: Props) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'public_thread' | 'private_thread'>('public_thread')
  const [archive, setArchive] = useState(1440)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const selectThread = useCommunityStore((state) => state.setSelectedThread)

  useEffect(() => {
    if (!open) return
    setName(sourceMessage?.content?.slice(0, 70) || '')
    setKind('public_thread')
    setArchive(1440)
    setError('')
  }, [open, sourceMessage?.id])

  const create = async () => {
    if (!name.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      const thread = await communityApi.createThread(channelId, {
        name: name.trim(),
        kind,
        auto_archive_minutes: archive,
        source_message_id: sourceMessage?.id,
      })
      selectThread(thread)
      onClose()
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось создать обсуждение')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Новое обсуждение" contentClassName="max-w-md bg-surface-raised">
      <div className="p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-foreground">Новое обсуждение</h2>
            <p className="mt-1 text-sm text-text-quiet">Отдельная ветка разговора без шума в основном канале.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded p-1 text-text-quiet hover:bg-surface hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        {sourceMessage && (
          <div className="mb-4 border-l-2 border-primary pl-3 text-sm text-text-quiet">
            <span className="font-medium text-text-body">{sourceMessage.author.username}:</span>{' '}
            {sourceMessage.content || 'Вложение'}
          </div>
        )}
        {error && <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <label className="block text-xs font-bold uppercase tracking-wide text-text-quiet" htmlFor="thread-name">Название</label>
        <input id="thread-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} autoFocus className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3 text-sm outline-none ring-primary focus:ring-2" />
        <fieldset className="mt-5 grid grid-cols-2 gap-2">
          <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-text-quiet">Кто увидит</legend>
          <button type="button" onClick={() => setKind('public_thread')} className={`rounded-lg border p-3 text-left ${kind === 'public_thread' ? 'border-primary bg-primary/10' : 'border-border bg-surface'}`}>
            <Users className="mb-2 h-5 w-5" /><span className="block text-sm font-semibold">Все участники</span><span className="mt-1 block text-xs text-text-quiet">Публичное</span>
          </button>
          <button type="button" onClick={() => setKind('private_thread')} className={`rounded-lg border p-3 text-left ${kind === 'private_thread' ? 'border-primary bg-primary/10' : 'border-border bg-surface'}`}>
            <Lock className="mb-2 h-5 w-5" /><span className="block text-sm font-semibold">По приглашению</span><span className="mt-1 block text-xs text-text-quiet">Приватное</span>
          </button>
        </fieldset>
        <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-text-quiet" htmlFor="thread-archive">Автоархив</label>
        <select id="thread-archive" value={archive} onChange={(event) => setArchive(Number(event.target.value))} className="mt-2 h-10 w-full rounded-md bg-canvas-deep px-3 text-sm outline-none">
          <option value={60}>Через 1 час</option><option value={1440}>Через 24 часа</option><option value={4320}>Через 3 дня</option><option value={10080}>Через 7 дней</option>
        </select>
        <button type="button" onClick={() => void create()} disabled={!name.trim() || loading} className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50">
          <MessageCircle className="h-4 w-4" /> {loading ? 'Создание…' : 'Создать обсуждение'}
        </button>
      </div>
    </Modal>
  )
}
