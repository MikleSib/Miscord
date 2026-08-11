'use client'

import { BarChart3, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import unifiedWebSocketService from '../../services/unifiedWebSocketService'
import type { PollDraft } from '../../services/communityApi'
import { Modal } from '../ui/modal'

const DURATIONS = [
  [3600, '1 час'], [14400, '4 часа'], [28800, '8 часов'], [86400, '1 день'], [259200, '3 дня'], [604800, '7 дней'],
] as const

export function PollComposerButton({ channelId, disabled }: { channelId: number; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState([{ text: '', emoji: '' }, { text: '', emoji: '' }])
  const [multi, setMulti] = useState(false)
  const [duration, setDuration] = useState(86400)

  useEffect(() => {
    if (!open) return
    setQuestion(''); setAnswers([{ text: '', emoji: '' }, { text: '', emoji: '' }]); setMulti(false); setDuration(86400)
  }, [open])

  const validAnswers = answers.filter((answer) => answer.text.trim())
  const send = () => {
    if (!question.trim() || validAnswers.length < 2) return
    const poll: PollDraft = {
      question: question.trim(),
      answers: validAnswers.map((answer) => ({ text: answer.text.trim(), emoji: answer.emoji.trim() || null })),
      allow_multiselect: multi,
      duration_seconds: duration,
    }
    unifiedWebSocketService.send({ type: 'chat_message', text_channel_id: channelId, content: '', poll, client_nonce: crypto.randomUUID() })
    setOpen(false)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} aria-label="Создать опрос" title="Опрос" className="mr-1 flex h-11 w-11 items-center justify-center rounded-md text-text-quiet hover:bg-surface-raised hover:text-foreground disabled:opacity-40"><BarChart3 className="h-5 w-5" /></button>
      <Modal open={open} onClose={() => setOpen(false)} title="Создать опрос" contentClassName="max-w-lg bg-surface-raised">
        <div className="p-5">
          <div className="flex items-start justify-between"><div><h2 className="text-xl font-bold">Создать опрос</h2><p className="mt-1 text-sm text-text-quiet">Результаты откроются после завершения.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="rounded p-1 text-text-quiet hover:bg-surface"><X className="h-5 w-5" /></button></div>
          <label htmlFor="poll-question" className="mt-5 block text-xs font-bold uppercase tracking-wide text-text-quiet">Вопрос</label>
          <input id="poll-question" value={question} maxLength={300} onChange={(event) => setQuestion(event.target.value)} className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3 outline-none focus:ring-2 focus:ring-primary" />
          <fieldset className="mt-5"><legend className="text-xs font-bold uppercase tracking-wide text-text-quiet">Варианты ответа</legend><div className="mt-2 space-y-2">{answers.map((answer, index) => <div key={index} className="flex gap-2"><input aria-label={`Эмодзи варианта ${index + 1}`} value={answer.emoji} maxLength={8} onChange={(event) => setAnswers((items) => items.map((item, i) => i === index ? { ...item, emoji: event.target.value } : item))} placeholder="🙂" className="h-10 w-14 rounded-md bg-canvas-deep px-2 text-center outline-none" /><input aria-label={`Вариант ${index + 1}`} value={answer.text} maxLength={200} onChange={(event) => setAnswers((items) => items.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} className="h-10 min-w-0 flex-1 rounded-md bg-canvas-deep px-3 text-sm outline-none focus:ring-2 focus:ring-primary" />{answers.length > 2 && <button type="button" onClick={() => setAnswers((items) => items.filter((_, i) => i !== index))} aria-label={`Удалить вариант ${index + 1}`} className="rounded p-2 text-text-quiet hover:bg-destructive/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>}</div>)}</div>{answers.length < 10 && <button type="button" onClick={() => setAnswers((items) => [...items, { text: '', emoji: '' }])} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#aab1ff]"><Plus className="h-4 w-4" /> Добавить вариант</button>}</fieldset>
          <div className="mt-5 grid grid-cols-2 gap-3"><label className="text-xs font-bold uppercase tracking-wide text-text-quiet">Длительность<select value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="mt-2 h-10 w-full rounded-md bg-canvas-deep px-3 text-sm font-normal normal-case text-foreground outline-none">{DURATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="flex items-end gap-3 rounded-md bg-canvas-deep px-3 py-2.5 text-sm"><input type="checkbox" checked={multi} onChange={(event) => setMulti(event.target.checked)} className="h-4 w-4 accent-primary" /> Несколько вариантов</label></div>
          <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-md px-4 py-2 text-sm hover:bg-surface">Отмена</button><button type="button" onClick={send} disabled={!question.trim() || validAnswers.length < 2} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50">Опубликовать</button></div>
        </div>
      </Modal>
    </>
  )
}
