'use client'

import { Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { communityApi } from '../../services/communityApi'
import type { Thread } from '../../types/community'
import { Modal } from '../ui/modal'

interface ThreadSettingsDialogProps {
  thread: Thread
  open: boolean
  onClose: () => void
  onUpdated: (thread: Thread) => void
  onDeleted: () => void
}

export function ThreadSettingsDialog({ thread, open, onClose, onUpdated, onDeleted }: ThreadSettingsDialogProps) {
  const [name, setName] = useState(thread.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(thread.name)
    setConfirmDelete(false)
    setError('')
  }, [open, thread.id, thread.name])

  const save = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      onUpdated(await communityApi.updateThread(thread.id, { name: name.trim() }))
      onClose()
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось переименовать обсуждение')
    } finally {
      setLoading(false)
    }
  }

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setLoading(true)
    setError('')
    try {
      await communityApi.deleteThread(thread.id)
      onDeleted()
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось удалить обсуждение')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Настройки обсуждения" contentClassName="max-w-md bg-surface-raised">
      <div className="p-5">
        <header className="flex items-start justify-between"><h2 className="text-xl font-bold">Настройки обсуждения</h2><button type="button" onClick={onClose} aria-label="Закрыть" className="rounded p-1 text-text-quiet hover:bg-surface"><X className="h-5 w-5" /></button></header>
        {error && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <label htmlFor="thread-settings-name" className="mt-5 block text-xs font-bold uppercase tracking-wide text-text-quiet">Название</label>
        <input id="thread-settings-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className="mt-2 h-10 w-full rounded-md bg-canvas-deep px-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
          <button type="button" onClick={() => void remove()} disabled={loading} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-red-300 hover:bg-destructive/10"><Trash2 className="h-4 w-4" />{confirmDelete ? 'Подтвердить удаление' : 'Удалить'}</button>
          <button type="button" onClick={() => void save()} disabled={!name.trim() || name.trim() === thread.name || loading} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}</button>
        </div>
      </div>
    </Modal>
  )
}
