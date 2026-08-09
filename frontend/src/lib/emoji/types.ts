/** [символ, короткое имя для :shortcode:, ключевые слова для поиска по-русски] */
export type EmojiEntry = readonly [char: string, name: string, keywords: string]

export type EmojiCategoryId =
  | 'recent'
  | 'smileys'
  | 'people'
  | 'nature'
  | 'food'
  | 'activity'
  | 'travel'
  | 'objects'
  | 'symbols'

export interface EmojiCategory {
  id: EmojiCategoryId
  label: string
  icon: string
  entries: EmojiEntry[]
}
