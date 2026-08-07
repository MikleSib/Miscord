/**
 * Нормализует URL картинок/аватаров к пути на текущем сайте.
 * В базе могут лежать полные URL (https://miscord.ru/...) или localhost — браузеры
 * по-разному обрабатывают битые/чужие хосты, поэтому всегда берём /static/...
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null

  const trimmed = url.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('/static/')) {
    return trimmed
  }

  const marker = '/static/'
  const index = trimmed.indexOf(marker)
  if (index >= 0) {
    return trimmed.slice(index)
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed)
      if (parsed.pathname.startsWith('/static/')) {
        return `${parsed.pathname}${parsed.search}`
      }
    } catch {
      return trimmed
    }
  }

  return trimmed
}
