import { describe, expect, it } from 'vitest'
import { mapServerChannel } from '../serverChannelMapping'

describe('server channel mapping', () => {
  it('preserves text and voice category placement after a full reload', () => {
    const text = mapServerChannel(8, { id: 100, name: 'text', category_id: 4 }, 'text')
    const voice = mapServerChannel(8, { id: 9, name: 'voice', category_id: 4 }, 'voice')

    expect(text.category_id).toBe(4)
    expect(voice.category_id).toBe(4)
  })

  it('normalizes a missing category to null', () => {
    expect(mapServerChannel(8, { id: 9, name: 'voice' }, 'voice').category_id).toBeNull()
  })

  it('preserves Stage kind during cached and network server synchronization', () => {
    const stage = mapServerChannel(
      8,
      { id: 17, name: 'town-hall', type: 'voice', kind: 'stage' },
      'voice',
    )
    expect(stage.kind).toBe('stage')
    expect(mapServerChannel(8, { id: 18, name: 'voice' }, 'voice').kind).toBe('voice')
  })
})
