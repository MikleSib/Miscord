import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CollapsedCategoriesState {
  /** Ключ — `${serverId}:${categoryId}`. Хранится только то, что свёрнуто. */
  collapsed: Record<string, boolean>
  toggle: (serverId: number, categoryId: number) => void
  isCollapsed: (serverId: number, categoryId: number) => boolean
}

const key = (serverId: number, categoryId: number) => `${serverId}:${categoryId}`

export const migrateCollapsedCategories = (persisted: unknown) =>
  persisted as Partial<CollapsedCategoriesState>

export const useChannelCategoryStore = create<CollapsedCategoriesState>()(
  persist(
    (set, get) => ({
      collapsed: {},
      toggle: (serverId, categoryId) =>
        set((state) => {
          const id = key(serverId, categoryId)
          const next = { ...state.collapsed }
          if (next[id]) {
            delete next[id]
          } else {
            next[id] = true
          }
          return { collapsed: next }
        }),
      isCollapsed: (serverId, categoryId) => Boolean(get().collapsed[key(serverId, categoryId)]),
    }),
    {
      name: 'miscord-collapsed-categories',
      version: 1,
      migrate: migrateCollapsedCategories,
    },
  ),
)
