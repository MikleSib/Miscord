'use client'

import { useEffect, useMemo } from 'react'
import { AlertCircle, Clock3, Loader2, RotateCcw, X } from 'lucide-react'
import { User } from '../types'
import { OutgoingMessage, useOutgoingMessageStore } from '../store/outgoingMessageStore'
import { UserAvatar } from './ui/user-avatar'

const phaseLabels: Record<OutgoingMessage['phase'], string> = {
  queued: 'В очереди', uploading: 'Загрузка', processing: 'Обработка файла…', sending: 'Отправляется…', awaiting_ack: 'Подтверждение…', offline: 'Ожидает подключения', failed: 'Не отправлено',
}

export function OutgoingMessageCard({ message, author, compact = false }: { message: OutgoingMessage; author: User; compact?: boolean }) {
  const retry = useOutgoingMessageStore((state) => state.retry)
  const cancel = useOutgoingMessageStore((state) => state.cancel)
  const previews = useMemo(() => message.attachments.map((attachment) => ({ localId: attachment.localId, url: URL.createObjectURL(attachment.file), type: attachment.file.type })), [message.attachments])
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews])
  const uploadedBytes = message.attachments.reduce((sum, item) => sum + item.file.size * (item.progress / 100), 0)
  const totalBytes = message.attachments.reduce((sum, item) => sum + item.file.size, 0)
  const totalProgress = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100
  const isActive = ['uploading', 'processing', 'sending', 'awaiting_ack'].includes(message.phase)

  return <article className={`group flex gap-3 px-4 py-2 ${compact ? 'justify-end' : ''} ${message.phase === 'failed' ? 'bg-red-500/5' : 'bg-white/[0.015]'}`} aria-live="polite" data-client-nonce={message.clientNonce}>
    {!compact && <UserAvatar user={author} size={40} className="mt-0.5 shrink-0" />}
    <div className={`min-w-0 ${compact ? 'max-w-[86%]' : 'flex-1'}`}>
      {!compact && <div className="mb-1 flex items-center gap-2"><span className="truncate text-sm font-semibold text-white">{author.display_name || author.username}</span><span className="text-xs text-[#949ba4]">сейчас</span></div>}
      <div className={compact ? 'rounded-2xl rounded-br-md bg-[#5865f2] px-3.5 py-2 text-white' : ''}>
        {message.content && <p className="whitespace-pre-wrap break-words text-[15px] leading-5">{message.content}</p>}
        {message.attachments.length > 0 && <div className={`mt-2 grid gap-2 ${message.attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {message.attachments.map((attachment) => {
            const preview = previews.find((item) => item.localId === attachment.localId)
            return <div key={attachment.localId} className="relative min-h-28 max-w-sm overflow-hidden rounded-xl bg-black/30">
              {preview?.type.startsWith('video/') ? <video src={preview.url} className="h-full max-h-72 w-full object-cover opacity-80" muted playsInline /> : <img src={preview?.url} alt={attachment.file.name} className="h-full max-h-72 w-full object-cover opacity-80" />}
              {attachment.phase !== 'uploaded' && <div className="absolute inset-0 flex items-center justify-center bg-black/35"><div className="relative grid size-14 place-items-center rounded-full bg-black/70 text-xs font-semibold text-white" role="progressbar" aria-label={`Загрузка ${attachment.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={attachment.progress}><span>{attachment.progress}%</span><svg className="absolute inset-0 size-14 -rotate-90" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="25" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="3" /><circle cx="28" cy="28" r="25" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${attachment.progress * 1.57} 157`} /></svg></div></div>}
              <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-5 text-[11px] text-white">{attachment.file.name}</div>
            </div>
          })}
        </div>}
      </div>
      <div className={`mt-1 flex min-h-6 items-center gap-2 text-xs ${message.phase === 'failed' ? 'text-red-400' : 'text-[#949ba4]'}`}>
        {message.phase === 'failed' ? <AlertCircle className="size-3.5" /> : isActive ? <Loader2 className="size-3.5 animate-spin" /> : <Clock3 className="size-3.5" />}
        <span>{phaseLabels[message.phase]}{message.phase === 'uploading' ? ` · ${totalProgress}%` : ''}</span>
        {message.error?.message && <span className="truncate">· {message.error.message}</span>}
        {message.phase === 'failed' && message.error?.retryable && <button type="button" onClick={() => retry(message.clientNonce)} className="ml-1 inline-flex min-h-8 items-center gap-1 rounded-md px-2 font-medium text-white hover:bg-white/10" aria-label="Повторить отправку"><RotateCcw className="size-3.5" /> Повторить</button>}
        {message.phase !== 'awaiting_ack' && <button type="button" onClick={() => void cancel(message.clientNonce)} className="inline-grid size-8 place-items-center rounded-md hover:bg-white/10 hover:text-white" aria-label={message.phase === 'failed' ? 'Удалить сообщение' : 'Отменить отправку'}><X className="size-4" /></button>}
      </div>
    </div>
  </article>
}
