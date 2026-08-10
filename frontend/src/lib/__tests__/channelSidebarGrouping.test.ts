import { describe, expect, it } from 'vitest'
import type { ChannelCategory } from '../../services/categoryService'
import type { Channel } from '../../types'
import { buildSidebarChannelGroups } from '../channelGrouping'

const categories: ChannelCategory[] = [
  { id: 1, name: 'Text', server_id: 10, position: 0 },
  { id: 2, name: 'Voice', server_id: 10, position: 1 },
  { id: 3, name: 'Empty', server_id: 10, position: 2 },
]

function channel(id: number, type: 'text' | 'voice', categoryId: number): Channel {
  return {
    id,
    name: `channel-${id}`,
    type,
    serverId: 10,
    position: 0,
    category_id: categoryId,
  }
}

describe('sidebar category grouping', () => {
  it('does not render voice-only and empty categories in both sections', () => {
    const groups = buildSidebarChannelGroups(
      [channel(1, 'text', 1)],
      [channel(2, 'voice', 2)],
      categories,
      false,
    )

    expect(groups.textGroups.map((group) => group.category?.id)).toEqual([1, 3])
    expect(groups.voiceGroups.map((group) => group.category?.id)).toEqual([2])
  })

  it('hides every empty category while searching', () => {
    const groups = buildSidebarChannelGroups([], [], categories, true)

    expect(groups.textGroups).toEqual([])
    expect(groups.voiceGroups).toEqual([])
  })
})
