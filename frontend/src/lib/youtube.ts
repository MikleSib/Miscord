/** Разбор ссылок YouTube и готовые URL для превью/плеера */

export type YoutubeInfo = {
  videoId: string
  watchUrl: string
  embedUrl: string
  thumbnailUrl: string
}

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

export function parseYoutubeInfo(rawUrl: string): YoutubeInfo | null {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase()
    if (!YT_HOSTS.has(host)) return null

    let videoId: string | null = null

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] || null
    } else {
      const path = url.pathname
      if (path === '/watch') {
        videoId = url.searchParams.get('v')
      } else {
        const match = path.match(/^\/(embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})/)
        if (match) videoId = match[2]
      }
    }

    if (!videoId || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return null

    return {
      videoId,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
      // hqdefault почти всегда есть; maxres иногда 404
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    }
  } catch {
    return null
  }
}
