'use client'

import { Archive, Lock, MessageCircle, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDismissOnOutsidePointer } from '../../hooks/useDismissOnOutsidePointer'
import { communityApi } from '../../services/communityApi'
import { useCommunityStore } from '../../store/communityStore'
import type { Thread } from '../../types/community'
import { ThreadDialog } from './ThreadDialog'

export function ThreadLauncher({ channelId }: { channelId: number }) {
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [threads, setThreads] = useState<Thread[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const setSelected = useCommunityStore((state) => state.setSelectedThread)
  const close = useCallback(() => setOpen(false), [])

  useDismissOnOutsidePointer(containerRef, open, close)

  useEffect(() => {
    if (!open) return
    void communityApi.listThreads(channelId, true).then(setThreads).catch(() => setThreads([]))
  }, [open, channelId])

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label="Обсуждения" aria-expanded={open} className="interactive-row flex items-center p-2 text-muted-foreground hover:text-foreground">
        <MessageCircle className="h-5 w-5" />
      </button>
      {open && (
        <section className="absolute right-0 top-10 z-40 w-[340px] overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
          <header className="flex items-center border-b border-border px-4 py-3">
            <h3 className="font-bold">Обсуждения</h3>
            <button type="button" onClick={() => setCreateOpen(true)} className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-[#aab1ff] hover:bg-surface"><Plus className="h-4 w-4" /> Создать</button>
          </header>
          <div className="max-h-80 overflow-y-auto p-2">
            {threads.map((thread) => (
              <button key={thread.id} type="button" onClick={() => { setSelected(thread); setOpen(false) }} className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface">
                {thread.kind === 'private_thread' ? <Lock className="mt-0.5 h-4 w-4 text-text-quiet" /> : thread.archived_at ? <Archive className="mt-0.5 h-4 w-4 text-text-quiet" /> : <MessageCircle className="mt-0.5 h-4 w-4 text-text-quiet" />}
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{thread.name}</span><span className="mt-0.5 block text-xs text-text-quiet">{thread.member_count} участников</span></span>
              </button>
            ))}
            {threads.length === 0 && <p className="px-4 py-8 text-center text-sm text-text-quiet">Активных обсуждений пока нет.</p>}
          </div>
        </section>
      )}
      <ThreadDialog open={createOpen} channelId={channelId} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
