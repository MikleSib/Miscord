/** Достаём http(s) ссылки из текста сообщения */

export const URL_RE =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,63}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:\?|#|$)/i
const TRAILING_PUNCT_RE = /[),.!?;:]+$/

export type TextSegment =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string; href: string }

export function stripTrailingPunct(raw: string): { core: string; trailing: string } {
  const match = raw.match(TRAILING_PUNCT_RE)
  if (!match) return { core: raw, trailing: '' }
  return {
    core: raw.slice(0, raw.length - match[0].length),
    trailing: match[0],
  }
}

export function normalizeUrl(raw: string): string {
  const { core } = stripTrailingPunct(raw)
  try {
    const url = new URL(core)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.href
  } catch {
    return ''
  }
}

export function extractUrls(content: string | null | undefined): string[] {
  if (!content) return []
  const re = new RegExp(URL_RE.source, 'gi')
  const seen = new Set<string>()
  const urls: string[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    const href = normalizeUrl(match[0])
    if (!href || seen.has(href)) continue
    seen.add(href)
    urls.push(href)
  }
  return urls
}

export function isDirectImageUrl(url: string): boolean {
  try {
    return IMAGE_EXT_RE.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** Приглашение Miscord: /invite/CODE */
export function parseInviteCode(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    const isMiscord =
      host === 'miscord.ru' ||
      host === 'localhost' ||
      host.endsWith('.miscord.ru') ||
      host === '127.0.0.1'
    if (!isMiscord) return null
    const match = parsed.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)/)
    return match?.[1] || null
  } catch {
    return null
  }
}

/** Разбивает кусок текста на обычный текст и кликабельные ссылки */
export function splitTextWithLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  const re = new RegExp(URL_RE.source, 'gi')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    const index = match.index
    if (index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, index) })
    }

    const { core, trailing } = stripTrailingPunct(match[0])
    const href = normalizeUrl(core)
    if (href) {
      segments.push({ type: 'url', value: core, href })
      if (trailing) segments.push({ type: 'text', value: trailing })
    } else {
      segments.push({ type: 'text', value: match[0] })
    }

    lastIndex = index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: text }]
}
