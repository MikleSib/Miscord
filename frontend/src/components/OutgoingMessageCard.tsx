'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Clock3, File, Music, RotateCcw, X } from 'lucide-react'
import { User } from '../types'
import { OutgoingMessage, useOutgoingMessageStore } from '../store/outgoingMessageStore'
import { chatAttachmentKind } from '../lib/chatAttachments'
import { UserAvatar } from './ui/user-avatar'

const phaseLabels: Record<OutgoingMessage['phase'], string> = {
  queued: 'В очереди',
  uploading: 'Загрузка',
  processing: 'Обработка файла...',
  sending: 'Отправляется...',
  awaiting_ack: 'Отправляется...',
  offline: 'Ожидает подключения',
  failed: 'Не отправлено',
}

const STATUS_DELAY_MS = 5000

function sizeLabel(size: number): string {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`
}

function mediaGridClass(count: number): string {
  if (count === 2) return 'grid-cols-2'
  if (count === 3) return 'h-72 grid-cols-[2fr_1fr] grid-rows-2 sm:h-80'
  if (count === 4) return 'grid-cols-2'
  if (count > 4) return 'grid-cols-3'
  return 'grid-cols-1'
}

function mediaItemClass(count: number, index: number): string {
  if (count === 1) return 'aspect-video'
  if (count === 3) return index === 0 ? 'row-span-2 h-full' : 'h-full'
  return 'aspect-square'
}

export function OutgoingMessageCard({ message, author, compact = false, grouped = false }: { message: OutgoingMessage; author: User; compact?: boolean; grouped?: boolean }) {
  const retry = useOutgoingMessageStore((state) => state.retry)
  const cancel = useOutgoingMessageStore((state) => state.cancel)
  const [showStatus, setShowStatus] = useState(() => {
    if (message.phase === 'failed') return true
    return Date.now() - new Date(message.createdAt).getTime() >= STATUS_DELAY_MS
  })
  const [previews] = useState(() => message.attachments.map((attachment) => ({
    localId: attachment.localId,
    url: URL.createObjectURL(attachment.file),
    type: attachment.file.type,
  })))

  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews])

  useEffect(() => {
    if (message.phase === 'failed') {
      setShowStatus(true)
      return
    }

    const remaining = STATUS_DELAY_MS - (Date.now() - new Date(message.createdAt).getTime())
    if (remaining <= 0) {
      setShowStatus(true)
      return
    }

    setShowStatus(false)
    const timer = window.setTimeout(() => setShowStatus(true), remaining)
    return () => window.clearTimeout(timer)
  }, [message.clientNonce, message.createdAt, message.phase])

  const uploadedBytes = message.attachments.reduce((sum, item) => sum + item.file.size * (item.progress / 100), 0)
  const totalBytes = message.attachments.reduce((sum, item) => sum + item.file.size, 0)
  const totalProgress = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100
  const mediaAttachments = message.attachments.filter((item) => {
    const kind = chatAttachmentKind(item.file)
    return kind === 'image' || kind === 'video'
  })
  const otherAttachments = message.attachments.filter((item) => {
    const kind = chatAttachmentKind(item.file)
    return kind === 'audio' || kind === 'file'
  })

  return <article className={`group flex gap-3 px-4 py-2 ${compact ? 'justify-end' : ''} ${message.phase === 'failed' ? 'bg-red-500/5' : ''}`} aria-live="polite" data-client-nonce={message.clientNonce}>
    {!compact && (grouped
      ? <div className="w-10 shrink-0" aria-hidden="true" />
      : <UserAvatar user={author} size={40} className="mt-0.5 shrink-0" />)}
    <div className={`min-w-0 ${compact ? 'max-w-[86%]' : 'flex-1'}`}>
      {!compact && !grouped && <div className="mb-1 flex items-center gap-2"><span className="truncate text-sm font-semibold text-white">{author.display_name || author.username}</span><span className="text-xs text-[#949ba4]">сейчас</span></div>}
      <div className={compact ? 'rounded-2xl rounded-br-md bg-[#5865f2] px-3.5 py-2 text-white' : ''}>
        {message.content && <p className="whitespace-pre-wrap break-words text-[15px] leading-5">{message.content}</p>}
        {mediaAttachments.length > 0 && <div className={`mt-2 grid w-full max-w-lg gap-1 overflow-hidden rounded-xl ${mediaGridClass(mediaAttachments.length)}`}>
          {mediaAttachments.map((attachment, index) => {
            const preview = previews.find((item) => item.localId === attachment.localId)
            const kind = chatAttachmentKind(attachment.file)
            return <div key={attachment.localId} className={`relative min-h-0 min-w-0 overflow-hidden bg-black/30 ${mediaItemClass(mediaAttachments.length, index)}`}>
              {kind === 'video'
                ? <video src={preview?.url} className="size-full object-cover" muted playsInline preload="metadata" />
                : <img src={preview?.url} alt={attachment.file.name} className="size-full object-cover" />}
              {attachment.phase !== 'uploaded' && <div className="absolute inset-0 flex items-center justify-center bg-black/35"><div className="relative grid size-14 place-items-center rounded-full bg-black/70 text-xs font-semibold text-white" role="progressbar" aria-label={`Загрузка ${attachment.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={attachment.progress}><span>{attachment.progress}%</span><svg className="absolute inset-0 size-14 -rotate-90" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="25" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="3" /><circle cx="28" cy="28" r="25" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${attachment.progress * 1.57} 157`} /></svg></div></div>}
              <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-5 text-[11px] text-white">{attachment.file.name}</div>
            </div>
          })}
        </div>}
        {otherAttachments.length > 0 && <div className="mt-2 grid w-full max-w-sm gap-2">
          {otherAttachments.map((attachment) => {
            const preview = previews.find((item) => item.localId === attachment.localId)
            const kind = chatAttachmentKind(attachment.file)
            return <div key={attachment.localId} className="relative overflow-hidden rounded-xl bg-[#2b2d31] p-3 text-[#dbdee1]">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#1e1f22] text-[#8b95ff]">{kind === 'audio' ? <Music className="h-5 w-5" /> : <File className="h-5 w-5" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{attachment.file.name}</span><span className="block text-xs text-[#949ba4]">{sizeLabel(attachment.file.size)}</span></span>
                {attachment.phase !== 'uploaded' && <span className="shrink-0 text-xs text-[#b5bac1]">{attachment.progress}%</span>}
              </div>
              {kind === 'audio' && preview?.url && <audio controls preload="metadata" src={preview.url} className="mt-2 h-10 w-full" />}
              {attachment.phase !== 'uploaded' && <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30" role="progressbar" aria-label={`Загрузка ${attachment.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={attachment.progress}><div className="h-full bg-[#5865f2]" style={{ width: `${attachment.progress}%` }} /></div>}
            </div>
          })}
        </div>}
      </div>
      {showStatus && <div className={`mt-1 flex h-8 items-center gap-2 overflow-hidden text-xs ${message.phase === 'failed' ? 'text-red-400' : 'text-[#949ba4]'}`}>
        {message.phase === 'failed' ? <AlertCircle className="size-3.5 shrink-0" /> : <Clock3 className="size-3.5 shrink-0" />}
        <span className="shrink-0">{phaseLabels[message.phase]}{message.phase === 'uploading' ? ` · ${totalProgress}%` : ''}</span>
        {message.error?.message && <span className="min-w-0 truncate">· {message.error.message}</span>}
        {message.phase === 'failed' && message.error?.retryable && <button type="button" onClick={() => retry(message.clientNonce)} className="ml-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 font-medium text-white hover:bg-white/10" aria-label="Повторить отправку"><RotateCcw className="size-3.5" /> Повторить</button>}
        {message.phase !== 'awaiting_ack' && <button type="button" onClick={() => void cancel(message.clientNonce)} className="inline-grid size-8 shrink-0 place-items-center rounded-md hover:bg-white/10 hover:text-white" aria-label={message.phase === 'failed' ? 'Удалить сообщение' : 'Отменить отправку'}><X className="size-4" /></button>}
      </div>}
    </div>
  </article>
}
