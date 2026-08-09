const STORAGE_KEY = 'miscord-recent-emoji'

export const EMOJI_RECENT_LIMIT = 24

export function loadRecentEmoji(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.length <= 16)
      .slice(0, EMOJI_RECENT_LIMIT)
  } catch {
    return []
  }
}

export function rememberRecentEmoji(char: string): string[] {
  const next = [char, ...loadRecentEmoji().filter((item) => item !== char)].slice(
    0,
    EMOJI_RECENT_LIMIT,
  )
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // приватный режим — история не критична
    }
  }
  return next
}
