import { describe, expect, it } from 'vitest'
import type { ChannelCategory } from '../../services/categoryService'
import { resolveCategoryLoadView } from './channelCategoryLoadState'

const category = (id: number, name: string): ChannelCategory => ({
  id,
  name,
  server_id: Math.floor(id / 10),
  position: id,
})

describe('channel category load state', () => {
  const cache = { 1: [category(10, 'Сервер 1')] }

  it('does not render categories from the previous server while the next server loads', () => {
    expect(resolveCategoryLoadView(2, cache, {})).toEqual({
      categories: [],
      ready: false,
      loading: true,
      error: null,
    })
  })

  it('renders cached categories immediately when returning to a server', () => {
    const cached = [category(20, 'Сервер 2')]
    expect(resolveCategoryLoadView(2, { ...cache, 2: cached }, {})).toMatchObject({
      categories: cached,
      ready: true,
      loading: false,
    })
  })
})
