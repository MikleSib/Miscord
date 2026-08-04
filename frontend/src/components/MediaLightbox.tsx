'use client'

import { useEffect, useState } from 'react'
import {
  X,
  Download,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  Share2,
  MoreHorizontal,
} from 'lucide-react'
import { UserAvatar } from './ui/user-avatar'
import { formatMessageFullTime, cn } from '../lib/utils'

export type MediaLightboxItem = {
  url: string
  alt?: string
  author?: {
    username?: string
    display_name?: string
    avatar_url?: string | null
  } | null
  timestamp?: string
}

interface MediaLightboxProps {
  item: MediaLightboxItem | null
  onClose: () => void
}

export function MediaLightbox({ item, onClose }: MediaLightboxProps) {
  const [zoomed, setZoomed] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    if (!item) return

    setZoomed(false)
    setMoreOpen(false)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [item, onClose])

  if (!item) return null

  const displayName = item.author?.display_name || item.author?.username || 'Вложение'
  const fileName = item.url.split('/').pop()?.split('?')[0] || 'media'

  const handleDownload = async () => {
    try {
      const response = await fetch(item.url)
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(item.url, '_blank', 'noopener,noreferrer')
    }
  }

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ url: item.url, title: displayName })
        return
      }
    } catch {
      // ignore cancel
    }

    try {
      await navigator.clipboard.writeText(item.url)
    } catch {
      // ignore
    }
  }

  const handleOpenOriginal = () => {
    window.open(item.url, '_blank', 'noopener,noreferrer')
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(item.url)
    } catch {
      // ignore
    }
    setMoreOpen(false)
  }

  return (
    <div
      className="media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр медиа"
      onClick={onClose}
    >
      <div className="media-lightbox__top" onClick={(event) => event.stopPropagation()}>
        <div className="media-lightbox__author">
          {item.author && (
            <>
              <UserAvatar user={item.author} size={40} />
              <div className="min-w-0">
                <div className="media-lightbox__author-name truncate">{displayName}</div>
                {item.timestamp && (
                  <div className="media-lightbox__author-time">
                    {formatMessageFullTime(item.timestamp)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="media-lightbox__actions">
          <div className="media-lightbox__toolbar">
            <button
              type="button"
              className="media-lightbox__tool"
              title={zoomed ? 'Уменьшить' : 'Увеличить'}
              onClick={() => setZoomed((value) => !value)}
            >
              {zoomed ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
            </button>
            <button
              type="button"
              className="media-lightbox__tool"
              title="Поделиться"
              onClick={handleShare}
            >
              <Share2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="media-lightbox__tool"
              title="Скачать"
              onClick={handleDownload}
            >
              <Download className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="media-lightbox__tool"
              title="Открыть оригинал"
              onClick={handleOpenOriginal}
            >
              <ExternalLink className="h-5 w-5" />
            </button>
            <div className="relative">
              <button
                type="button"
                className="media-lightbox__tool"
                title="Ещё"
                onClick={() => setMoreOpen((value) => !value)}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {moreOpen && (
                <div className="media-lightbox__menu">
                  <button type="button" onClick={handleCopyLink}>
                    Копировать ссылку
                  </button>
                  <button type="button" onClick={handleOpenOriginal}>
                    Открыть в новой вкладке
                  </button>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            className="media-lightbox__close"
            title="Закрыть"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className={cn('media-lightbox__stage', zoomed && 'is-zoomed')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.alt || 'Медиа'}
          className={cn('media-lightbox__media', zoomed && 'is-zoomed')}
          draggable={false}
          onClick={(event) => {
            event.stopPropagation()
            setZoomed((value) => !value)
          }}
        />
      </div>
    </div>
  )
}
