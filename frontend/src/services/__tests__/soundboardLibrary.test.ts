import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('soundboard library', () => {
  beforeEach(() => {
    vi.resetModules()
    const values = new Map<string, string>()
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('persists favorites and orders frequent sounds by usage', async () => {
    const library = await import('../soundboardLibrary')
    expect(library.toggleFavorite(7).favorites).toEqual([7])
    expect(library.toggleFavorite(7).favorites).toEqual([])

    library.recordSoundUse(4)
    library.recordSoundUse(9)
    const state = library.recordSoundUse(9)
    expect(library.frequentSoundIds(state)).toEqual([9, 4])
  })
})
