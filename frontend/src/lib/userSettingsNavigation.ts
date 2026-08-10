export type UserSettingsTab = 'profile' | 'voice'

export const OPEN_USER_SETTINGS_EVENT = 'miscord:open-user-settings'

export function openUserSettings(tab: UserSettingsTab = 'profile') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_USER_SETTINGS_EVENT, { detail: { tab } }))
}

export function getUserSettingsTab(event: Event): UserSettingsTab {
  const tab = (event as CustomEvent<{ tab?: unknown }>).detail?.tab
  return tab === 'voice' ? 'voice' : 'profile'
}
