'use client'

import { isImageAttachment } from '../lib/chatAttachments'
import { resolveMediaUrl } from '../lib/mediaUrl'

interface GalleryAttachment {
  id: number
  file_url: string
  filename?: string | null
  content_type?: string | null
}

function gridClass(count: number): string {
  if (count === 2) return 'grid-cols-2'
  if (count === 3) return 'h-72 grid-cols-[2fr_1fr] grid-rows-2 sm:h-96'
  if (count === 4) return 'grid-cols-2'
  if (count > 4) return 'grid-cols-3'
  return 'grid-cols-1'
}

function itemClass(count: number, index: number): string {
  if (count === 1) return 'max-h-[420px]'
  if (count === 3) return index === 0 ? 'row-span-2 h-full' : 'h-full'
  return 'aspect-square'
}

export function MessageAttachmentGallery({
  attachments,
  onOpen,
}: {
  attachments: GalleryAttachment[]
  onOpen: (url: string) => void
}) {
  const images = (attachments || []).filter((item) => isImageAttachment(item.content_type, item.file_url))
  if (!images.length) return null

  return (
    <div className={`mt-2 grid w-full max-w-[520px] gap-1 overflow-hidden rounded-xl ${gridClass(images.length)}`}>
      {images.map((item, index) => {
        const url = resolveMediaUrl(item.file_url) || item.file_url
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(url)}
            className={`media-thumb min-h-0 min-w-0 overflow-hidden bg-[#1e1f22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5865f2] ${itemClass(images.length, index)}`}
            aria-label={`Открыть ${item.filename || 'изображение'}`}
          >
            <img
              src={url}
              alt={item.filename || 'Вложение'}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className={`h-full w-full ${images.length === 1 ? 'max-h-[420px] object-contain' : 'object-cover'}`}
            />
          </button>
        )
      })}
    </div>
  )
}
