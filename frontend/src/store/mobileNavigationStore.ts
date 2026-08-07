import { create } from 'zustand'

export type MobileRootTab = 'servers' | 'messages' | 'profile'
export type MobilePane = 'root' | 'servers' | 'channels' | 'chat' | 'members' | 'settings' | 'call'

export interface MobileNavigationSnapshot {
  rootTab: MobileRootTab
  pane: MobilePane
  channelDrawerOpen: boolean
  memberDrawerOpen: boolean
  homeDetailOpen: boolean
}

interface MobileNavigationState extends MobileNavigationSnapshot {
  navigate: (next: Partial<MobileNavigationSnapshot>) => MobileNavigationSnapshot
  applySnapshot: (snapshot: MobileNavigationSnapshot) => void
  reset: () => void
}

const initialState: MobileNavigationSnapshot = {
  rootTab: 'messages',
  pane: 'root',
  channelDrawerOpen: false,
  memberDrawerOpen: false,
  homeDetailOpen: false,
}

export const useMobileNavigationStore = create<MobileNavigationState>((set, get) => ({
  ...initialState,
  navigate: (next) => {
    const snapshot = {
      rootTab: next.rootTab ?? get().rootTab,
      pane: next.pane ?? get().pane,
      channelDrawerOpen: next.channelDrawerOpen ?? get().channelDrawerOpen,
      memberDrawerOpen: next.memberDrawerOpen ?? get().memberDrawerOpen,
      homeDetailOpen: next.homeDetailOpen ?? get().homeDetailOpen,
    }
    set(snapshot)
    return snapshot
  },
  applySnapshot: (snapshot) => set(snapshot),
  reset: () => set(initialState),
}))

export function isMobileNavigationSnapshot(value: unknown): value is MobileNavigationSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<MobileNavigationSnapshot>
  return (
    (snapshot.rootTab === 'servers' || snapshot.rootTab === 'messages' || snapshot.rootTab === 'profile') &&
    typeof snapshot.pane === 'string' &&
    typeof snapshot.channelDrawerOpen === 'boolean' &&
    typeof snapshot.memberDrawerOpen === 'boolean' &&
    typeof snapshot.homeDetailOpen === 'boolean'
  )
}

