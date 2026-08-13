'use client'

import { useCallback, useEffect } from 'react'
import categoryService, {
  type ChannelCategory,
  type ChannelPlacement,
} from '../../services/categoryService'
import unifiedWebSocketService from '../../services/unifiedWebSocketService'
import { GatewayEvents } from '../../lib/gatewayEvents'
import {
  resolveCategoryLoadView,
} from './channelCategoryLoadState'
import { useChannelCategoryDataStore } from '../../store/channelCategoryDataStore'

interface CategoryEventPayload {
  data?: {
    server_id?: number
    category?: ChannelCategory
    category_id?: number
  }
}

function sortCategories(categories: ChannelCategory[]): ChannelCategory[] {
  return [...categories].sort((a, b) => a.position - b.position || a.id - b.id)
}

const requestVersions = new Map<number, number>()

export function useChannelCategories(serverId: number | null) {
  const categoriesByServer = useChannelCategoryDataStore((state) => state.categoriesByServer)
  const errorsByServer = useChannelCategoryDataStore((state) => state.errorsByServer)
  const updateCachedCategories = useChannelCategoryDataStore((state) => state.setCategories)
  const updateCachedError = useChannelCategoryDataStore((state) => state.setError)
  const categoryView = resolveCategoryLoadView(serverId, categoriesByServer, errorsByServer)

  const setCategories = useCallback(
    (update: ChannelCategory[] | ((previous: ChannelCategory[]) => ChannelCategory[])) => {
      if (serverId == null) return
      requestVersions.set(serverId, (requestVersions.get(serverId) ?? 0) + 1)
      updateCachedCategories(serverId, update)
    },
    [serverId, updateCachedCategories],
  )

  const setCurrentError = useCallback((message: string) => {
    if (serverId == null) return
    updateCachedError(serverId, message)
  }, [serverId, updateCachedError])

  const reload = useCallback(async () => {
    if (serverId == null) return
    const requestedServerId = serverId
    const requestVersion = (requestVersions.get(requestedServerId) ?? 0) + 1
    requestVersions.set(requestedServerId, requestVersion)
    updateCachedError(requestedServerId)
    try {
      const loaded = sortCategories(await categoryService.list(requestedServerId))
      if (requestVersions.get(requestedServerId) !== requestVersion) return
      updateCachedCategories(requestedServerId, loaded)
    } catch {
      if (requestVersions.get(requestedServerId) !== requestVersion) return
      updateCachedError(requestedServerId, 'Не удалось загрузить категории')
    }
  }, [serverId, updateCachedCategories, updateCachedError])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void reload()
    })
    return () => {
      cancelled = true
    }
  }, [reload])

  useEffect(() => {
    if (serverId == null) return

    const upsert = (payload: CategoryEventPayload) => {
      const category = payload?.data?.category
      if (!category || payload.data?.server_id !== serverId) return
      setCategories((previous) =>
        sortCategories([
          ...previous.filter((item) => item.id !== category.id),
          category,
        ]),
      )
    }

    const remove = (payload: CategoryEventPayload) => {
      const categoryId = payload?.data?.category_id
      if (categoryId == null || payload.data?.server_id !== serverId) return
      setCategories((previous) => previous.filter((item) => item.id !== categoryId))
    }

    unifiedWebSocketService.on(GatewayEvents.CHANNEL_CATEGORY_CREATED, upsert)
    unifiedWebSocketService.on(GatewayEvents.CHANNEL_CATEGORY_UPDATED, upsert)
    unifiedWebSocketService.on(GatewayEvents.CHANNEL_CATEGORY_DELETED, remove)
    return () => {
      unifiedWebSocketService.off(GatewayEvents.CHANNEL_CATEGORY_CREATED, upsert)
      unifiedWebSocketService.off(GatewayEvents.CHANNEL_CATEGORY_UPDATED, upsert)
      unifiedWebSocketService.off(GatewayEvents.CHANNEL_CATEGORY_DELETED, remove)
    }
  }, [serverId, setCategories])

  const createCategory = useCallback(
    async (name: string) => {
      if (serverId == null || !name.trim()) return false
      try {
        const created = await categoryService.create(serverId, name.trim())
        setCategories((previous) => sortCategories([...previous, created]))
        return true
      } catch {
        setCurrentError('Не удалось создать категорию')
        return false
      }
    },
    [serverId, setCategories, setCurrentError],
  )

  const renameCategory = useCallback(async (categoryId: number, name: string) => {
    if (!name.trim()) return
    try {
      const updated = await categoryService.rename(categoryId, name.trim())
      setCategories((previous) =>
        sortCategories(previous.map((item) => (item.id === categoryId ? updated : item))),
      )
    } catch {
      setCurrentError('Не удалось переименовать категорию')
    }
  }, [setCategories, setCurrentError])

  const deleteCategory = useCallback(async (categoryId: number) => {
    try {
      await categoryService.remove(categoryId)
      setCategories((previous) => previous.filter((item) => item.id !== categoryId))
    } catch {
      setCurrentError('Не удалось удалить категорию')
    }
  }, [setCategories, setCurrentError])

  const moveChannels = useCallback(
    async (placements: ChannelPlacement[]) => {
      if (serverId == null || placements.length === 0) return
      try {
        await categoryService.reorder(serverId, placements)
      } catch {
        setCurrentError('Не удалось изменить порядок каналов')
      }
    },
    [serverId, setCurrentError],
  )

  return {
    categories: categoryView.categories,
    categoriesReady: categoryView.ready,
    categoriesLoading: categoryView.loading,
    categoriesError: categoryView.error,
    reloadCategories: reload,
    createCategory,
    renameCategory,
    deleteCategory,
    moveChannels,
  }
}
