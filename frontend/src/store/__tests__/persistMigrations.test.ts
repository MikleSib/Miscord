import { describe, expect, it } from 'vitest'

import { migrateAccessibilitySettings } from '../accessibilitySettingsStore'
import { migrateCollapsedCategories } from '../channelCategoryStore'
import { migrateHotkeys } from '../hotkeyStore'
import { migrateSoundSettings } from '../soundSettingsStore'

const versionedStores = [
  ['accessibility', migrateAccessibilitySettings],
  ['channel categories', migrateCollapsedCategories],
] as const

describe('versioned persisted stores', () => {
  it.each(versionedStores)('%s keeps older persisted state through an explicit migration', (_name, migrate) => {
    expect(migrate({ marker: true })).toEqual({ marker: true })
  })

  it('hotkeys keeps valid bindings and repairs invalid data', () => {
    expect(migrateHotkeys({ bindings: [{ id: 'one' }] }).bindings).toHaveLength(1)
    expect(migrateHotkeys({ bindings: 'broken' })).toEqual({ bindings: [] })
  })

  it('sounds merges older preferences with current defaults', () => {
    expect(migrateSoundSettings({ enabled: { 'mic-on': false } }).enabled['mic-on']).toBe(false)
    expect(Object.keys(migrateSoundSettings(null).enabled).length).toBeGreaterThan(1)
  })
})
