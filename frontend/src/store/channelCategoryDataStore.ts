import { create } from 'zustand'

import type { ChannelCategory } from '../services/categoryService'

type CategoryUpdate =
  | ChannelCategory[]
  | ((previous: ChannelCategory[]) => ChannelCategory[])

interface ChannelCategoryDataState {
  categoriesByServer: Record<number, ChannelCategory[]>
  errorsByServer: Record<number, string | undefined>
  setCategories: (serverId: number, update: CategoryUpdate) => void
  setError: (serverId: number, error?: string) => void
  clear: () => void
}

export const useChannelCategoryDataStore = create<ChannelCategoryDataState>((set) => ({
  categoriesByServer: {},
  errorsByServer: {},
  setCategories: (serverId, update) => set((state) => {
    const previous = state.categoriesByServer[serverId] ?? []
    const categories = typeof update === 'function' ? update(previous) : update
    return {
      categoriesByServer: { ...state.categoriesByServer, [serverId]: categories },
      errorsByServer: { ...state.errorsByServer, [serverId]: undefined },
    }
  }),
  setError: (serverId, error) => set((state) => ({
    errorsByServer: { ...state.errorsByServer, [serverId]: error },
  })),
  clear: () => set({ categoriesByServer: {}, errorsByServer: {} }),
}))
