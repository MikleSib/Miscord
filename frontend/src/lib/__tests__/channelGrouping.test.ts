import { describe, expect, it } from 'vitest'
import { buildPlacementsForMove, groupChannelsByCategory } from '../channelGrouping'
import type { ChannelCategory } from '../../services/categoryService'
import type { Channel } from '../../types'

const categories: ChannelCategory[] = [
  { id: 1, name: 'Общение', server_id: 10, position: 0 },
  { id: 2, name: 'Игры', server_id: 10, position: 1 },
]

function channel(id: number, categoryId: number | null, position = 0): Channel {
  return {
    id,
    name: `канал-${id}`,
    type: 'text',
    serverId: 10,
    position,
    category_id: categoryId,
  }
}

describe('группировка каналов по категориям', () => {
  it('ставит каналы без категории первыми', () => {
    const groups = groupChannelsByCategory(
      [channel(1, 1), channel(2, null), channel(3, 2)],
      categories,
    )

    expect(groups[0].category).toBeNull()
    expect(groups[0].channels.map((item) => item.id)).toEqual([2])
    expect(groups[1].category?.id).toBe(1)
    expect(groups[2].category?.id).toBe(2)
  })

  it('сохраняет пустые категории, чтобы в них можно было перетащить канал', () => {
    const groups = groupChannelsByCategory([channel(1, 1)], categories)
    expect(groups).toHaveLength(2)
    expect(groups[1].channels).toEqual([])
  })

  it('не теряет канал из удалённой категории', () => {
    const groups = groupChannelsByCategory([channel(1, 99)], categories)
    expect(groups[0].category).toBeNull()
    expect(groups[0].channels.map((item) => item.id)).toEqual([1])
  })

  it('сортирует каналы внутри категории по позиции', () => {
    const groups = groupChannelsByCategory(
      [channel(1, 1, 2), channel(2, 1, 0), channel(3, 1, 1)],
      categories,
    )
    expect(groups[0].channels.map((item) => item.id)).toEqual([2, 3, 1])
  })

  it('не создаёт группу без категории, если все каналы распределены', () => {
    const groups = groupChannelsByCategory([channel(1, 1), channel(2, 2)], categories)
    expect(groups.every((group) => group.category !== null)).toBe(true)
  })
})

describe('перемещение канала', () => {
  it('вставляет канал в целевую категорию и пересчитывает позиции', () => {
    const moved = channel(5, null)
    const groups = groupChannelsByCategory(
      [moved, channel(1, 1, 0), channel(2, 1, 1)],
      categories,
    )

    const placements = buildPlacementsForMove(groups, moved, 1, 1)

    expect(placements).toEqual([
      { id: 1, type: 'text', position: 0, category_id: 1 },
      { id: 5, type: 'text', position: 1, category_id: 1 },
      { id: 2, type: 'text', position: 2, category_id: 1 },
    ])
  })

  it('не дублирует канал при перемещении внутри той же категории', () => {
    const moved = channel(1, 1, 0)
    const groups = groupChannelsByCategory([moved, channel(2, 1, 1)], categories)

    const placements = buildPlacementsForMove(groups, moved, 1, 5)

    expect(placements.map((item) => item.id)).toEqual([2, 1])
  })

  it('переносит канал в группу без категории', () => {
    const moved = channel(1, 1)
    const groups = groupChannelsByCategory([moved, channel(2, null)], categories)

    const placements = buildPlacementsForMove(groups, moved, null, 0)

    expect(placements).toEqual([
      { id: 1, type: 'text', position: 0, category_id: null },
      { id: 2, type: 'text', position: 1, category_id: null },
    ])
  })
})
