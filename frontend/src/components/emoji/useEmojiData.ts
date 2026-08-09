'use client'

import { useEffect, useState } from 'react'
import {
  getLoadedEmojiCategories,
  loadEmojiCategories,
  loadRecentEmoji,
  type EmojiCategory,
} from '../../lib/emoji'

export function useEmojiData(active: boolean) {
  const [categories, setCategories] = useState<EmojiCategory[] | null>(getLoadedEmojiCategories)
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    if (!active) return

    let cancelled = false
    setRecent(loadRecentEmoji())
    void loadEmojiCategories().then((loaded) => {
      if (!cancelled) setCategories(loaded)
    })

    return () => {
      cancelled = true
    }
  }, [active])

  return { categories, recent, setRecent }
}
