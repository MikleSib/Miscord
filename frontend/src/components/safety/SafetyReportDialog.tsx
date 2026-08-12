'use client'

import { useEffect, useState } from 'react'
import { Flag, X } from 'lucide-react'

import { Button } from '../ui/button'
import { safetyService } from '../../services/safetyService'


type Category = 'spam' | 'harassment' | 'hate' | 'sexual' | 'violence' | 'impersonation' | 'other'

interface SafetyReportDialogProps {
  open: boolean
  onClose: () => void
  targetUserId?: number
  serverId?: number
  channelId?: number
  messageId?: number
}


export function SafetyReportDialog(props: SafetyReportDialogProps) {
  const [category, setCategory] = useState<Category>('spam')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    if (!props.open) return
    setCategory('spam')
    setDetails('')
    setFeedback('')
  }, [props.open])

  if (!props.open) return null

  const submit = async () => {
    setBusy(true)
    setFeedback('')
    try {
      await safetyService.report({
        target_user_id: props.targetUserId,
        server_id: props.serverId,
        channel_id: props.channelId,
        message_id: props.messageId,
        category,
        details: details.trim() || undefined,
      })
      setFeedback('Жалоба отправлена команде безопасности.')
      window.setTimeout(props.onClose, 800)
    } catch (error: any) {
      setFeedback(error.response?.data?.detail || 'Не удалось отправить жалобу.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[220] grid place-items-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><Flag className="h-5 w-5 text-destructive" /><h2 id="report-title" className="text-lg font-semibold">Пожаловаться</h2></div><button type="button" onClick={props.onClose} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Закрыть"><X className="h-5 w-5" /></button></div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Жалоба содержит идентификаторы пользователя и сообщения, но не копирует личную переписку.</p>
        <label className="mt-5 block text-sm font-medium">Причина<select className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3" value={category} onChange={(event) => setCategory(event.target.value as Category)}><option value="spam">Спам</option><option value="harassment">Травля</option><option value="hate">Язык ненависти</option><option value="sexual">Нежелательный сексуальный контент</option><option value="violence">Угрозы или насилие</option><option value="impersonation">Выдаёт себя за другого</option><option value="other">Другое</option></select></label>
        <label className="mt-4 block text-sm font-medium">Комментарий<textarea className="mt-2 min-h-28 w-full resize-y rounded-md bg-canvas-deep p-3 text-sm" maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Добавьте контекст, который поможет разобраться" /></label>
        {feedback && <p className="mt-3 text-sm text-muted-foreground" role="status">{feedback}</p>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={props.onClose}>Отмена</Button><Button disabled={busy} onClick={() => void submit()}>{busy ? 'Отправляем…' : 'Отправить жалобу'}</Button></div>
      </div>
    </div>
  )
}
