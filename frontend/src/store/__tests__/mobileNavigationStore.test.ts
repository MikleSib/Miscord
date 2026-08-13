import { beforeEach, describe, expect, it } from 'vitest'
import { resolveMemberSidebarVisibility, useMobileNavigationStore } from '../mobileNavigationStore'

describe('mobileNavigationStore', () => {
  beforeEach(() => useMobileNavigationStore.getState().reset())

  it('opens a channel without changing the selected root section', () => {
    useMobileNavigationStore.getState().navigate({ rootTab: 'servers', pane: 'channels' })
    useMobileNavigationStore.getState().navigate({ pane: 'chat' })

    expect(useMobileNavigationStore.getState()).toMatchObject({
      rootTab: 'servers',
      pane: 'chat',
      memberDrawerOpen: false,
    })
  })

  it('closes independent drawers without losing the current pane', () => {
    useMobileNavigationStore.getState().navigate({
      rootTab: 'servers',
      pane: 'chat',
      memberDrawerOpen: true,
    })
    useMobileNavigationStore.getState().navigate({ memberDrawerOpen: false })

    expect(useMobileNavigationStore.getState()).toMatchObject({
      pane: 'chat',
      memberDrawerOpen: false,
    })
  })

  it('resets to the direct-message root', () => {
    useMobileNavigationStore.getState().navigate({ rootTab: 'servers', pane: 'call' })
    useMobileNavigationStore.getState().reset()

    expect(useMobileNavigationStore.getState()).toMatchObject({
      rootTab: 'messages',
      pane: 'root',
      homeDetailOpen: false,
    })
  })

  it('uses the drawer as the single source of truth on mobile', () => {
    expect(resolveMemberSidebarVisibility('phone', true, false)).toBe(false)
    expect(resolveMemberSidebarVisibility('tablet', false, true)).toBe(true)
    expect(resolveMemberSidebarVisibility('desktop', true, false)).toBe(true)
  })
})
