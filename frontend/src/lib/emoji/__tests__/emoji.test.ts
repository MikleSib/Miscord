import { beforeAll, describe, expect, it } from 'vitest'
import {
  getActiveShortcodeQuery,
  insertEmojiAtCaret,
  loadEmojiCategories,
  replaceShortcode,
  searchEmoji,
  type EmojiCategory,
} from '../index'

let categories: EmojiCategory[]

beforeAll(async () => {
  categories = await loadEmojiCategories()
})

describe('каталог эмодзи', () => {
  it('загружает все категории с уникальными символами', () => {
    expect(categories.length).toBeGreaterThanOrEqual(8)

    const chars = categories.flatMap((category) => category.entries.map((entry) => entry[0]))
    expect(chars.length).toBeGreaterThan(500)
    expect(new Set(chars).size).toBe(chars.length)
  })

  it('не содержит записей без имени или ключевых слов', () => {
    for (const category of categories) {
      for (const [char, name] of category.entries) {
        expect(char.length).toBeGreaterThan(0)
        expect(name).toMatch(/^[a-z0-9_+-]+$/)
      }
    }
  })
})

describe('поиск эмодзи', () => {
  it('находит по русскому ключевому слову', () => {
    const found = searchEmoji(categories, 'огонь')
    expect(found[0]?.[0]).toBe('🔥')
  })

  it('находит по английскому имени', () => {
    expect(searchEmoji(categories, 'thumbsup')[0]?.[0]).toBe('👍')
  })

  it('ставит точное совпадение имени выше частичного', () => {
    expect(searchEmoji(categories, 'cat')[0]?.[1]).toBe('cat')
  })

  it('возвращает пустой список на пустой запрос', () => {
    expect(searchEmoji(categories, '   ')).toEqual([])
  })
})

describe('автодополнение :shortcode:', () => {
  it('распознаёт код в начале строки и после пробела', () => {
    expect(getActiveShortcodeQuery(':fir', 4)).toEqual({ start: 0, query: 'fir' })
    expect(getActiveShortcodeQuery('привет :sm', 10)).toEqual({ start: 7, query: 'sm' })
  })

  it('игнорирует одиночное двоеточие и время', () => {
    expect(getActiveShortcodeQuery(':', 1)).toBeNull()
    expect(getActiveShortcodeQuery('12:30', 5)).toBeNull()
  })

  it('заменяет код символом и ставит курсор после него', () => {
    const result = replaceShortcode('привет :fire', 12, 7, '🔥')
    expect(result.value).toBe('привет 🔥 ')
    expect(result.caret).toBe(result.value.length)
  })
})

describe('вставка эмодзи в поле ввода', () => {
  it('добавляет пробел перед символом, если его нет', () => {
    expect(insertEmojiAtCaret('привет', 6, 6, '🔥').value).toBe('привет 🔥 ')
  })

  it('не дублирует пробел', () => {
    expect(insertEmojiAtCaret('привет ', 7, 7, '🔥').value).toBe('привет 🔥 ')
  })

  it('заменяет выделенный фрагмент', () => {
    expect(insertEmojiAtCaret('привет мир', 7, 10, '🔥').value).toBe('привет 🔥 ')
  })
})
