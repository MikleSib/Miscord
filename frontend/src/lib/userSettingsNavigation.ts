export type UserSettingsTab = 'profile' | 'voice' | 'hotkeys' | 'accessibility'

export const OPEN_USER_SETTINGS_EVENT = 'miscord:open-user-settings'

export function openUserSettings(tab: UserSettingsTab = 'profile') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_USER_SETTINGS_EVENT, { detail: { tab } }))
}

export function getUserSettingsTab(event: Event): UserSettingsTab {
  const tab = (event as CustomEvent<{ tab?: unknown }>).detail?.tab
  if (tab === 'voice' || tab === 'hotkeys' || tab === 'accessibility') return tab
  return 'profile'
}
