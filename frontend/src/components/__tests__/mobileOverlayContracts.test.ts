import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readRelative = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('mobile overlay layout contracts', () => {
  const css = readRelative('../../app/styles/mobile-overlays.css')

  it('renders server settings as mutually exclusive list and detail screens', () => {
    expect(css).toContain("[data-mobile-detail='open'] .miscord-settings-sidebar")
    expect(css).toContain("[data-mobile-detail='open'] .miscord-settings-detail")
    expect(css).toContain('.server-settings-nav-close')
  })

  it('keeps the invite dialog content-height on phones', () => {
    expect(css).toContain('.invite-people-modal .invite-people-card')
    expect(css).toContain('height: auto !important')
    expect(css).toContain('.invite-people-link-row')
  })

  it('keeps screen-share actions inside a viewport-safe footer', () => {
    expect(css).toContain('.screen-share-picker__footer')
    expect(css).toContain('.screen-share-picker__actions')
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)')
    expect(css).toContain('env(safe-area-inset-bottom)')
  })
})
