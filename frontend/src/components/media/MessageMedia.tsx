'use client'

import { useEffect, useState } from 'react'
import type { MessageGif, ServerExpression } from '../../types'
import expressionService from '../../services/expressionService'
import { MessageContent } from '../MessageContent'

const CUSTOM_EMOJI = /<:([a-zA-Z0-9_]{2,64}):(\d+)>/g

function CustomEmoji({ id, name }: { id: number; name: string }) {
  const [item, setItem] = useState<ServerExpression | null>(null)
  useEffect(() => {
    let active = true
    expressionService.get(id).then((value) => { if (active) setItem(value) }).catch(() => undefined)
    return () => { active = false }
  }, [id])
  if (!item) return <span>{`:${name}:`}</span>
  return <img src={item.file_url} alt={`:${name}:`} title={`:${name}:`} className="mx-0.5 inline-block h-7 w-7 object-contain align-middle" loading="lazy" />
}

export function RichMessageContent(props: React.ComponentProps<typeof MessageContent>) {
  const content = props.content || ''
  const chunks: React.ReactNode[] = []
  let cursor = 0
  for (const match of content.matchAll(CUSTOM_EMOJI)) {
    const index = match.index ?? 0
    if (index > cursor) chunks.push(<MessageContent key={`text-${cursor}`} {...props} content={content.slice(cursor, index)} />)
    chunks.push(<CustomEmoji key={`emoji-${match[2]}-${index}`} id={Number(match[2])} name={match[1]} />)
    cursor = index + match[0].length
  }
  if (cursor === 0) return <MessageContent {...props} />
  if (cursor < content.length) chunks.push(<MessageContent key={`text-${cursor}`} {...props} content={content.slice(cursor)} />)
  return <>{chunks}</>
}

export function MessageMedia({ stickers = [], gif }: { stickers?: ServerExpression[]; gif?: MessageGif | null }) {
  if (!stickers.length && !gif) return null
  return (
    <div className="mt-2 flex max-w-[520px] flex-wrap gap-2" aria-label="Медиа сообщения">
      {stickers.map((sticker) => (
        <img key={sticker.id} src={sticker.file_url} alt={sticker.description || sticker.name} title={sticker.name} className="h-40 w-40 max-w-full object-contain" loading="lazy" />
      ))}
      {gif && (
        <figure className="m-0 overflow-hidden rounded-lg border border-border bg-black/20">
          <img src={gif.url} alt={gif.title || 'GIF'} className="block max-h-[360px] max-w-full object-contain" loading="lazy" />
          <figcaption className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-quiet">Powered by GIPHY</figcaption>
        </figure>
      )}
    </div>
  )
}

export function PendingMessageMedia({ stickerIds = [], gif }: { stickerIds?: number[]; gif?: MessageGif }) {
  const [stickers, setStickers] = useState<ServerExpression[]>([])
  useEffect(() => {
    let active = true
    Promise.all(stickerIds.map((id) => expressionService.get(id))).then((items) => {
      if (active) setStickers(items)
    }).catch(() => undefined)
    return () => { active = false }
  }, [stickerIds.join(',')])
  return <MessageMedia stickers={stickers} gif={gif} />
}
