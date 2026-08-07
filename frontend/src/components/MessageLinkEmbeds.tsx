'use client'

import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Users } from 'lucide-react'
import { InvitePreview, LinkEmbed } from '../types'
import { extractUrls, isDirectImageUrl, parseInviteCode } from '../lib/linkify'
import { parseYoutubeInfo, YoutubeInfo } from '../lib/youtube'
import { fetchLinkEmbed } from '../services/embedService'
import { serverService } from '../services/serverService'
import { resolveMediaUrl } from '../lib/mediaUrl'
import { MediaLightbox, MediaLightboxItem } from './MediaLightbox'
import { YoutubeEmbedCard } from './YoutubeEmbedCard'

const MAX_EMBEDS = 3

interface MessageLinkEmbedsProps {
  content: string | null | undefined
}

type EmbedState =
  | { kind: 'youtube'; info: YoutubeInfo }
  | { kind: 'image'; url: string }
  | { kind: 'invite'; url: string; preview: InvitePreview }
  | { kind: 'link'; embed: LinkEmbed }

export function MessageLinkEmbeds({ content }: MessageLinkEmbedsProps) {
  const urls = useMemo(() => extractUrls(content).slice(0, MAX_EMBEDS), [content])
  const urlsKey = urls.join('\n')
  const [embeds, setEmbeds] = useState<EmbedState[]>([])
  const [lightbox, setLightbox] = useState<MediaLightboxItem | null>(null)

  useEffect(() => {
    if (urls.length === 0) {
      setEmbeds([])
      return
    }

    let cancelled = false

    ;(async () => {
      const results: EmbedState[] = []

      for (const url of urls) {
        if (cancelled) return

        // YouTube — сразу в браузере (сервер до youtube.com не достучится)
        const yt = parseYoutubeInfo(url)
        if (yt) {
          results.push({ kind: 'youtube', info: yt })
          continue
        }

        if (isDirectImageUrl(url)) {
          results.push({ kind: 'image', url })
          continue
        }

        const inviteCode = parseInviteCode(url)
        if (inviteCode) {
          try {
            const preview = await serverService.getInvitePreview(inviteCode)
            if (cancelled) return
            results.push({ kind: 'invite', url, preview })
            continue
          } catch {
            // обычный OG-превью ниже
          }
        }

        const embed = await fetchLinkEmbed(url)
        if (cancelled) return
        if (embed?.type === 'image' && embed.image_url) {
          results.push({ kind: 'image', url: embed.image_url })
        } else if (embed && (embed.title || embed.description || embed.image_url || embed.site_name)) {
          // Пустой «только домен» без картинки — не показываем как карточку
          const isBareDomain =
            !embed.image_url &&
            !embed.description &&
            (!embed.title || embed.title === embed.site_name || embed.title === safeHostname(embed.url))
          if (!isBareDomain) {
            results.push({ kind: 'link', embed })
          }
        }
      }

      if (!cancelled) setEmbeds(results)
    })()

    return () => {
      cancelled = true
    }
  }, [urlsKey])

  if (embeds.length === 0) return null

  return (
    <div className="mt-2 flex flex-col gap-2">
      {embeds.map((item, index) => {
        if (item.kind === 'youtube') {
          return <YoutubeEmbedCard key={`yt-${item.info.videoId}-${index}`} info={item.info} />
        }

        if (item.kind === 'image') {
          return (
            <button
              key={`img-${index}-${item.url}`}
              type="button"
              className="media-thumb self-start"
              onClick={() => setLightbox({ url: item.url, alt: 'Изображение по ссылке' })}
            >
              <img
                src={item.url}
                alt="Превью изображения"
                className="max-h-80 max-w-md rounded-md object-cover"
                loading="lazy"
              />
            </button>
          )
        }

        if (item.kind === 'invite') {
          const icon = resolveMediaUrl(item.preview.server_icon)
          return (
            <a
              key={`invite-${item.preview.code}`}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block max-w-md overflow-hidden rounded-md border border-[#1e1f22] bg-[#2b2d31] no-underline transition hover:border-[#3f4147]"
            >
              <div className="border-l-4 border-[#23a559] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#b5bac1]">
                  Приглашение на сервер
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#1e1f22] text-lg font-bold text-white">
                    {icon ? (
                      <img src={icon} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (item.preview.server_name?.[0] || 'S').toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-white">
                      {item.preview.server_name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#b5bac1]">
                      <Users className="h-3.5 w-3.5" />
                      <span className="text-[#23a559]">{item.preview.online_count} онлайн</span>
                      <span>·</span>
                      <span>{item.preview.members_count} участников</span>
                    </p>
                  </div>
                </div>
                {item.preview.server_description && (
                  <p className="mt-2 line-clamp-2 text-sm text-[#dbdee1]">
                    {item.preview.server_description}
                  </p>
                )}
              </div>
            </a>
          )
        }

        const { embed } = item
        const image = embed.image_url
        return (
          <div
            key={`link-${embed.url}-${index}`}
            className="max-w-md overflow-hidden rounded-md border border-[#1e1f22] bg-[#2b2d31]"
          >
            <div className="flex border-l-4 border-[#5865f2]">
              <a
                href={embed.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 p-3 no-underline"
                onClick={(event) => event.stopPropagation()}
              >
                {(embed.site_name || embed.favicon_url) && (
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#b5bac1]">
                    {embed.favicon_url && (
                      <img
                        src={embed.favicon_url}
                        alt=""
                        className="h-3.5 w-3.5 rounded-sm"
                        loading="lazy"
                      />
                    )}
                    <span className="truncate">{embed.site_name || safeHostname(embed.url)}</span>
                  </div>
                )}
                {embed.title && (
                  <p className="text-[15px] font-semibold leading-snug text-[#00a8fc] hover:underline">
                    {embed.title}
                  </p>
                )}
                {embed.description && (
                  <p className="mt-1 line-clamp-3 text-sm leading-snug text-[#dbdee1]">
                    {embed.description}
                  </p>
                )}
                {!embed.title && !embed.description && (
                  <p className="flex items-center gap-1 text-sm text-[#00a8fc]">
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{embed.url}</span>
                  </p>
                )}
              </a>
              {image && (
                <button
                  type="button"
                  className="hidden w-[120px] shrink-0 self-stretch sm:block"
                  onClick={() => setLightbox({ url: image, alt: embed.title || 'Превью' })}
                >
                  <img
                    src={image}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              )}
            </div>
            {image && (
              <button
                type="button"
                className="block w-full sm:hidden"
                onClick={() => setLightbox({ url: image, alt: embed.title || 'Превью' })}
              >
                <img
                  src={image}
                  alt=""
                  className="max-h-56 w-full object-cover"
                  loading="lazy"
                />
              </button>
            )}
          </div>
        )
      })}

      <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
