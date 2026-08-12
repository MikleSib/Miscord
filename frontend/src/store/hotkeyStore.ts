import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { HotkeyAction, HotkeyBinding, HotkeyCombination } from '../lib/hotkeys'

const MAX_HOTKEYS = 12

function createId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `hotkey-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface HotkeyState {
  bindings: HotkeyBinding[]
  suspended: boolean
  addBinding: () => void
  removeBinding: (id: string) => void
  setAction: (id: string, action: HotkeyAction) => void
  setCombination: (id: string, combination: HotkeyCombination | null) => void
  setEnabled: (id: string, enabled: boolean) => void
  setSuspended: (suspended: boolean) => void
}

export const useHotkeyStore = create<HotkeyState>()(
  persist(
    (set) => ({
      bindings: [],
      suspended: false,
      addBinding: () => set((state) => {
        if (state.bindings.length >= MAX_HOTKEYS) return state
        return {
          bindings: [...state.bindings, {
            id: createId(),
            action: 'toggle-mute',
            combination: null,
            enabled: false,
          }],
        }
      }),
      removeBinding: (id) => set((state) => ({
        bindings: state.bindings.filter((binding) => binding.id !== id),
      })),
      setAction: (id, action) => set((state) => ({
        bindings: state.bindings.map((binding) => binding.id === id ? { ...binding, action } : binding),
      })),
      setCombination: (id, combination) => set((state) => ({
        bindings: state.bindings.map((binding) => binding.id === id
          ? { ...binding, combination, enabled: combination ? true : false }
          : binding),
      })),
      setEnabled: (id, enabled) => set((state) => ({
        bindings: state.bindings.map((binding) => binding.id === id
          ? { ...binding, enabled: binding.combination ? enabled : false }
          : binding),
      })),
      setSuspended: (suspended) => set({ suspended }),
    }),
    {
      name: 'miscord-hotkeys',
      version: 1,
      partialize: (state) => ({ bindings: state.bindings }),
    },
  ),
)

export { MAX_HOTKEYS }
