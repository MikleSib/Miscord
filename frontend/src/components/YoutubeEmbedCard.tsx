'use client'

import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { YoutubeInfo } from '../lib/youtube'

interface YoutubeEmbedCardProps {
  info: YoutubeInfo
}

type OEmbedData = {
  title?: string
  author_name?: string
  thumbnail_url?: string
}

export function YoutubeEmbedCard({ info }: YoutubeEmbedCardProps) {
  const [playing, setPlaying] = useState(false)
  const [meta, setMeta] = useState<OEmbedData | null>(null)

  // Заголовок берём с noembed (CORS есть) — сервер до YouTube не достучится
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    ;(async () => {
      try {
        const res = await fetch(
          `https://noembed.com/embed?url=${encodeURIComponent(info.watchUrl)}`,
          { signal: controller.signal }
        )
        if (!res.ok) return
        const data = (await res.json()) as OEmbedData
        if (!cancelled) setMeta(data)
      } catch {
        // без названия тоже ок — останется картинка и плеер
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [info.watchUrl])

  const title = meta?.title
  const author = meta?.author_name
  const thumb = meta?.thumbnail_url || info.thumbnailUrl

  return (
    <div className="max-w-[400px] overflow-hidden rounded-md border border-[#1e1f22] bg-[#2b2d31]">
      <div className="border-l-4 border-[#ff0000] p-3 pb-2">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#b5bac1]">
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[2px] bg-[#ff0000] text-[8px] font-black text-white">
            ▶
          </span>
          <span>YouTube</span>
          {author && <span className="normal-case tracking-normal text-[#949ba4]">· {author}</span>}
        </div>
        {title ? (
          <a
            href={info.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[15px] font-semibold leading-snug text-[#00a8fc] hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {title}
          </a>
        ) : (
          <a
            href={info.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm text-[#00a8fc] hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Смотреть на YouTube
          </a>
        )}
      </div>

      <div className="relative aspect-video w-full bg-black">
        {playing ? (
          <iframe
            src={info.embedUrl}
            title={title || 'YouTube video'}
            className="absolute inset-0 h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            className="group absolute inset-0"
            onClick={() => setPlaying(true)}
            aria-label="Смотреть видео"
          >
            <img
              src={thumb}
              alt={title || 'Превью YouTube'}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition group-hover:bg-black/35">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#ff0000] text-white shadow-lg transition group-hover:scale-105">
                <Play className="ml-0.5 h-7 w-7 fill-current" />
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
