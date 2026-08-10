import { describe, expect, it } from 'vitest'
import type { ChannelCategory } from '../../services/categoryService'
import type { Channel } from '../../types'
import { buildPlacementsForMove, groupChannelsByCategory } from '../channelGrouping'

const category: ChannelCategory = {
  id: 7,
  name: 'Team',
  server_id: 1,
  position: 0,
}

function voice(id: number, categoryId: number | null, position: number): Channel {
  return {
    id,
    name: `voice-${id}`,
    type: 'voice',
    serverId: 1,
    category_id: categoryId,
    position,
  }
}

describe('channel reordering', () => {
  it('moves a channel after another channel in the same category', () => {
    const first = voice(1, 7, 0)
    const groups = groupChannelsByCategory(
      [first, voice(2, 7, 1), voice(3, 7, 2)],
      [category],
    )

    const placements = buildPlacementsForMove(groups, first, 7, 2)

    expect(placements.map((item) => item.id)).toEqual([2, 1, 3])
    expect(placements.map((item) => item.position)).toEqual([0, 1, 2])
  })

  it('moves a channel to the end of the uncategorized list', () => {
    const middle = voice(2, null, 1)
    const groups = groupChannelsByCategory(
      [voice(1, null, 0), middle, voice(3, null, 2)],
      [category],
    )

    const placements = buildPlacementsForMove(groups, middle, null, 3)

    expect(placements.map((item) => item.id)).toEqual([1, 3, 2])
    expect(placements.every((item) => item.category_id === null)).toBe(true)
  })

  it('inserts a channel at an exact position in another category', () => {
    const moved = voice(1, null, 0)
    const groups = groupChannelsByCategory(
      [moved, voice(2, 7, 0), voice(3, 7, 1)],
      [category],
    )

    const placements = buildPlacementsForMove(groups, moved, 7, 1)

    expect(placements.map((item) => item.id)).toEqual([2, 1, 3])
    expect(placements.every((item) => item.category_id === 7)).toBe(true)
  })
})
