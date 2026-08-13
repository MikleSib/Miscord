'use client'

import { Loader2, Search, UserPlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { communityApi } from '../../services/communityApi'
import serverService from '../../services/serverService'
import type { ServerMember } from '../../types'
import type { Thread } from '../../types/community'
import { Modal } from '../ui/modal'
import { UserAvatar } from '../ui/user-avatar'

interface ThreadMembersDialogProps {
  thread: Thread
  open: boolean
  onClose: () => void
  onChanged: (memberCount: number) => void
}

export function ThreadMembersDialog({ thread, open, onClose, onChanged }: ThreadMembersDialogProps) {
  const [serverMembers, setServerMembers] = useState<ServerMember[]>([])
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  const reload = async () => {
    const currentRequest = ++requestId.current
    const [serverResult, threadMembers] = await Promise.all([
      serverService.getMembers(thread.server_id),
      communityApi.listThreadMembers(thread.id),
    ])
    if (currentRequest !== requestId.current) return
    setServerMembers(serverResult.members)
    setMemberIds(new Set(threadMembers.map((member) => member.user_id)))
    onChanged(threadMembers.length)
  }

  useEffect(() => {
    if (!open) return
    setQuery('')
    setError('')
    setLoading(true)
    const currentRequest = requestId.current + 1
    void reload()
      .catch(() => currentRequest === requestId.current && setError('Не удалось загрузить участников'))
      .finally(() => currentRequest === requestId.current && setLoading(false))
    return () => { requestId.current += 1 }
  }, [open, thread.id])

  const candidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return serverMembers.filter((member) => {
      const userId = Number(member.user_id ?? member.id)
      if (memberIds.has(userId)) return false
      const name = `${member.display_name || ''} ${member.username || ''}`.toLocaleLowerCase()
      return !needle || name.includes(needle)
    })
  }, [memberIds, query, serverMembers])

  const add = async (userId: number) => {
    setLoading(true)
    setError('')
    try {
      await communityApi.addThreadMember(thread.id, userId)
      await reload()
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось добавить участника')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Участники обсуждения" contentClassName="max-w-lg bg-surface-raised">
      <div className="p-5">
        <header className="flex items-start justify-between gap-3">
          <div><h2 className="text-xl font-bold">Добавить участников</h2><p className="mt-1 text-sm text-text-quiet">Только участники приватного обсуждения смогут его открыть.</p></div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded p-1 text-text-quiet hover:bg-surface"><X className="h-5 w-5" /></button>
        </header>
        {error && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <label className="mt-5 flex h-10 items-center gap-2 rounded-md bg-canvas-deep px-3">
          <Search className="h-4 w-4 text-text-quiet" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Поиск участников" placeholder="Найти участника сервера" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {loading && candidates.length === 0 ? <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-primary" /> : candidates.map((member) => {
            const userId = Number(member.user_id ?? member.id)
            return <button key={userId} type="button" onClick={() => void add(userId)} disabled={loading} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface disabled:opacity-50"><UserAvatar user={member as any} size={32} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{member.display_name || member.username}</span><UserPlus className="h-4 w-4 text-text-quiet" /></button>
          })}
          {!loading && candidates.length === 0 && <p className="py-8 text-center text-sm text-text-quiet">Все подходящие участники уже добавлены.</p>}
        </div>
      </div>
    </Modal>
  )
}
