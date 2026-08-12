import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadStore() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  return (await import('../accessibilitySettingsStore')).useAccessibilitySettingsStore
}

describe('accessibilitySettingsStore', () => {
  beforeEach(() => vi.resetModules())

  it('normalizes stepped values to supported options', async () => {
    const store = await loadStore()
    const state = store.getState()
    state.setChatFontSize(17)
    state.setMessageGroupSpacing(15)
    state.setZoomLevel(113)
    expect(store.getState()).toMatchObject({
      chatFontSize: 16,
      messageGroupSpacing: 16,
      zoomLevel: 110,
    })
  })

  it('stores density and readability preferences independently', async () => {
    const store = await loadStore()
    const state = store.getState()
    state.setInterfaceDensity('spacious')
    state.setMessageDisplay('compact')
    state.setUnderlineLinks(true)
    state.setDisplayNameStyles(false)
    expect(store.getState()).toMatchObject({
      interfaceDensity: 'spacious',
      messageDisplay: 'compact',
      underlineLinks: true,
      displayNameStyles: false,
    })
  })
})
