import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_SOUND_PREFERENCES, type SoundEventId } from '../lib/soundEvents'

interface SoundSettingsState {
  enabled: Record<SoundEventId, boolean>
  setEnabled: (id: SoundEventId, enabled: boolean) => void
  isEnabled: (id: SoundEventId) => boolean
}

export const useSoundSettingsStore = create<SoundSettingsState>()(
  persist(
    (set, get) => ({
      enabled: { ...DEFAULT_SOUND_PREFERENCES },
      setEnabled: (id, enabled) => set((state) => ({
        enabled: { ...state.enabled, [id]: enabled },
      })),
      isEnabled: (id) => get().enabled[id] !== false,
    }),
    {
      name: 'miscord-sound-settings',
      version: 1,
      partialize: (state) => ({ enabled: state.enabled }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SoundSettingsState>),
        enabled: {
          ...DEFAULT_SOUND_PREFERENCES,
          ...((persisted as Partial<SoundSettingsState>)?.enabled ?? {}),
        },
      }),
    },
  ),
)
