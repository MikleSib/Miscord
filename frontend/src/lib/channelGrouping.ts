import type { ChannelCategory } from '../services/categoryService'
import type { Channel } from '../types'

export interface ChannelGroup {
  /** null — каналы вне категорий, они показываются первыми. */
  category: ChannelCategory | null
  channels: Channel[]
}

function byPosition(a: Channel, b: Channel): number {
  return (a.position ?? 0) - (b.position ?? 0) || a.id - b.id
}

/**
 * Раскладывает каналы по категориям. Пустые категории сохраняются: иначе
 * в них нельзя перетащить канал и их не видно после создания.
 */
export function groupChannelsByCategory(
  channels: Channel[],
  categories: ChannelCategory[],
): ChannelGroup[] {
  const byCategory = new Map<number, Channel[]>()
  const uncategorized: Channel[] = []
  const knownCategories = new Set(categories.map((category) => category.id))

  for (const channel of channels) {
    const categoryId = channel.category_id
    if (categoryId == null || !knownCategories.has(categoryId)) {
      uncategorized.push(channel)
      continue
    }
    const bucket = byCategory.get(categoryId)
    if (bucket) {
      bucket.push(channel)
    } else {
      byCategory.set(categoryId, [channel])
    }
  }

  const groups: ChannelGroup[] = []
  if (uncategorized.length > 0) {
    groups.push({ category: null, channels: uncategorized.sort(byPosition) })
  }

  for (const category of categories) {
    groups.push({
      category,
      channels: (byCategory.get(category.id) ?? []).sort(byPosition),
    })
  }

  return groups
}

/** Пересчитывает позиции после перетаскивания канала в другую категорию. */
export function buildPlacementsForMove(
  groups: ChannelGroup[],
  movedChannel: Channel,
  targetCategoryId: number | null,
  targetIndex: number,
): { id: number; type: 'text' | 'voice'; position: number; category_id: number | null }[] {
  const target = groups.find((group) => (group.category?.id ?? null) === targetCategoryId)
  const remaining = (target?.channels ?? []).filter((channel) => channel.id !== movedChannel.id)
  const index = Math.max(0, Math.min(targetIndex, remaining.length))
  remaining.splice(index, 0, movedChannel)

  return remaining.map((channel, position) => ({
    id: channel.id,
    type: channel.type,
    position,
    category_id: targetCategoryId,
  }))
}
