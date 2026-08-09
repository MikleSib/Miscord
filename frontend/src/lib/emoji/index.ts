import type { EmojiCategory, EmojiEntry } from './types'

export type { EmojiCategory, EmojiCategoryId, EmojiEntry } from './types'
export {
  EMOJI_RECENT_LIMIT,
  loadRecentEmoji,
  rememberRecentEmoji,
} from './recent'

const CATEGORY_META: { id: EmojiCategory['id']; label: string; icon: string }[] = [
  { id: 'smileys', label: 'Смайлы и эмоции', icon: '😀' },
  { id: 'people', label: 'Люди и жесты', icon: '👋' },
  { id: 'nature', label: 'Животные и природа', icon: '🐶' },
  { id: 'food', label: 'Еда и напитки', icon: '🍔' },
  { id: 'activity', label: 'Активности', icon: '⚽' },
  { id: 'travel', label: 'Путешествия', icon: '🚗' },
  { id: 'objects', label: 'Предметы', icon: '💡' },
  { id: 'symbols', label: 'Символы', icon: '❤️' },
]

let cache: EmojiCategory[] | null = null
let pending: Promise<EmojiCategory[]> | null = null

/** Данные грузятся по требованию — пикер открывают далеко не в каждой сессии. */
export async function loadEmojiCategories(): Promise<EmojiCategory[]> {
  if (cache) return cache
  if (!pending) {
    pending = Promise.all([
      import('./catalog/smileys'),
      import('./catalog/people'),
      import('./catalog/nature'),
      import('./catalog/food'),
      import('./catalog/activity'),
      import('./catalog/travel'),
      import('./catalog/objects'),
      import('./catalog/symbols'),
    ]).then((modules) => {
      const entries = [
        modules[0].SMILEYS,
        modules[1].PEOPLE,
        modules[2].NATURE,
        modules[3].FOOD,
        modules[4].ACTIVITY,
        modules[5].TRAVEL,
        modules[6].OBJECTS,
        modules[7].SYMBOLS,
      ]
      cache = CATEGORY_META.map((meta, index) => ({ ...meta, entries: entries[index] }))
      return cache
    })
  }
  return pending
}

export function getLoadedEmojiCategories(): EmojiCategory[] | null {
  return cache
}

function scoreEntry(entry: EmojiEntry, query: string): number {
  const [, name, keywords] = entry
  if (name === query) return 0
  if (name.startsWith(query)) return 1

  const words = keywords.split(' ')
  if (words.some((word) => word === query)) return 2
  if (words.some((word) => word.startsWith(query))) return 3
  if (name.includes(query) || keywords.includes(query)) return 4
  return -1
}

export function searchEmoji(
  categories: EmojiCategory[],
  rawQuery: string,
  limit = 60,
): EmojiEntry[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return []

  const scored: { entry: EmojiEntry; score: number }[] = []
  for (const category of categories) {
    for (const entry of category.entries) {
      const score = scoreEntry(entry, query)
      if (score >= 0) scored.push({ entry, score })
    }
  }

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((item) => item.entry)
}

export function findEmojiByChar(
  categories: EmojiCategory[],
  char: string,
): EmojiEntry | null {
  for (const category of categories) {
    const found = category.entries.find((entry) => entry[0] === char)
    if (found) return found
  }
  return null
}

/** Активный ввод `:код` перед курсором — для автокомплита в поле сообщения. */
export function getActiveShortcodeQuery(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const before = value.slice(0, caret)
  const match = before.match(/(^|[\s([{])(:([a-z0-9_+-]{2,}))$/i)
  if (!match) return null

  return {
    start: caret - match[2].length,
    query: match[3].toLowerCase(),
  }
}

export function replaceShortcode(
  value: string,
  caret: number,
  start: number,
  char: string,
): { value: string; caret: number } {
  const token = `${char} `
  return {
    value: value.slice(0, start) + token + value.slice(caret),
    caret: start + token.length,
  }
}

export function insertEmojiAtCaret(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  char: string,
): { value: string; caret: number } {
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)
  const separator = before && !/\s$/.test(before) ? ' ' : ''
  const token = `${separator}${char} `
  return {
    value: before + token + after,
    caret: before.length + token.length,
  }
}
