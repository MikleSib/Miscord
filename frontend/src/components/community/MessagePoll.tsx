'use client'

import { Check, Clock3, Loader2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { communityApi } from '../../services/communityApi'
import unifiedWebSocketService from '../../services/unifiedWebSocketService'
import type { Poll } from '../../types/community'
import { cn } from '../../lib/utils'

export function MessagePoll({ initialPoll, canClose }: { initialPoll: Poll; canClose: boolean }) {
  const [poll, setPoll] = useState(initialPoll)
  const [pending, setPending] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [voters, setVoters] = useState<string[] | null>(null)

  useEffect(() => setPoll(initialPoll), [initialPoll])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const handler = (payload: any) => {
      const data = payload?.data ?? payload
      if (Number(data.poll_id) === poll.id) void communityApi.getPoll(poll.id).then(setPoll)
    }
    unifiedWebSocketService.on('POLL_STATE_UPDATE', handler)
    return () => unifiedWebSocketService.off('POLL_STATE_UPDATE', handler)
  }, [poll.id])

  const remaining = Math.max(0, new Date(poll.expires_at).getTime() - now)
  const timerLabel = poll.closed ? 'Завершён' : remaining < 60000 ? 'меньше минуты' : remaining < 3600000 ? `${Math.ceil(remaining / 60000)} мин` : remaining < 86400000 ? `${Math.ceil(remaining / 3600000)} ч` : `${Math.ceil(remaining / 86400000)} дн`
  const maxVotes = useMemo(() => Math.max(1, ...poll.answers.map((answer) => answer.vote_count || 0)), [poll.answers])

  const vote = async (answerId: number) => {
    if (poll.closed || pending !== null) return
    const previous = poll
    const target = poll.answers.find((answer) => answer.id === answerId)
    setPoll({ ...poll, answers: poll.answers.map((answer) => ({ ...answer, selected: answer.id === answerId ? !answer.selected : poll.allow_multiselect ? answer.selected : false })) })
    setPending(answerId)
    try { setPoll(target?.selected ? await communityApi.unvotePoll(poll.id, answerId) : await communityApi.votePoll(poll.id, answerId)) }
    catch { setPoll(previous) }
    finally { setPending(null) }
  }

  const showVoters = async (answerId: number) => {
    if (!poll.closed) return
    const result = await communityApi.listPollVoters(poll.id, answerId)
    setVoters(result.map((user) => user.display_name || user.username))
  }

  return (
    <section className="mt-2 w-full max-w-[520px] rounded-xl border border-border bg-canvas-deep p-4">
      <h3 className="text-base font-bold leading-6 text-foreground">{poll.question}</h3>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-text-quiet"><Clock3 className="h-3.5 w-3.5" /> {timerLabel}{!poll.closed && ' · результаты скрыты'}</p>
      <div className="mt-4 space-y-2">
        {poll.answers.map((answer) => {
          const percentage = poll.closed && poll.total_voters ? Math.round(((answer.vote_count || 0) / poll.total_voters) * 100) : 0
          return <button key={answer.id} type="button" onClick={() => poll.closed ? void showVoters(answer.id) : void vote(answer.id)} className={cn('relative flex min-h-11 w-full items-center overflow-hidden rounded-lg border px-3 text-left text-sm transition', answer.selected ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:border-primary/60')}><span className="absolute inset-y-0 left-0 bg-primary/15 transition-[width]" style={{ width: poll.closed ? `${percentage}%` : 0 }} /><span className="relative mr-2 flex h-5 w-5 items-center justify-center rounded-full border border-current">{answer.selected && <Check className="h-3 w-3" />}</span><span className="relative min-w-0 flex-1 truncate">{answer.emoji} {answer.text}</span>{pending === answer.id && <Loader2 className="relative h-4 w-4 animate-spin" />}{poll.closed && <span className="relative ml-3 text-xs font-semibold">{percentage}% · {answer.vote_count}</span>}</button>
        })}
      </div>
      <footer className="mt-3 flex items-center text-xs text-text-quiet">{poll.allow_multiselect && !poll.closed && 'Можно выбрать несколько вариантов'}{poll.closed && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {poll.total_voters} участников</span>}{canClose && !poll.closed && <button type="button" onClick={() => void communityApi.closePoll(poll.id).then(setPoll)} className="ml-auto font-medium text-[#aab1ff] hover:underline">Завершить опрос</button>}</footer>
      {voters && <div className="mt-3 rounded-md bg-surface px-3 py-2 text-xs text-text-body">{voters.length ? voters.join(', ') : 'Нет голосов'}<button type="button" onClick={() => setVoters(null)} className="ml-2 text-[#aab1ff]">скрыть</button></div>}
    </section>
  )
}
