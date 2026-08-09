'use client'

import { useCallback, useEffect, useState } from 'react'
import categoryService, {
  type ChannelCategory,
  type ChannelPlacement,
} from '../../services/categoryService'
import unifiedWebSocketService from '../../services/unifiedWebSocketService'
import { GatewayEvents } from '../../lib/gatewayEvents'

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

export function useChannelCategories(serverId: number | null) {
  const [categories, setCategories] = useState<ChannelCategory[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (serverId == null) {
      setCategories([])
      return
    }
    try {
      setCategories(sortCategories(await categoryService.list(serverId)))
      setError(null)
    } catch {
      // Категории не критичны: без них каналы просто показываются плоским списком
      setCategories([])
    }
  }, [serverId])

  useEffect(() => {
    void reload()
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
  }, [serverId])

  const createCategory = useCallback(
    async (name: string) => {
      if (serverId == null || !name.trim()) return
      try {
        const created = await categoryService.create(serverId, name.trim())
        setCategories((previous) => sortCategories([...previous, created]))
        setError(null)
      } catch {
        setError('Не удалось создать категорию')
      }
    },
    [serverId],
  )

  const renameCategory = useCallback(async (categoryId: number, name: string) => {
    if (!name.trim()) return
    try {
      const updated = await categoryService.rename(categoryId, name.trim())
      setCategories((previous) =>
        sortCategories(previous.map((item) => (item.id === categoryId ? updated : item))),
      )
      setError(null)
    } catch {
      setError('Не удалось переименовать категорию')
    }
  }, [])

  const deleteCategory = useCallback(async (categoryId: number) => {
    try {
      await categoryService.remove(categoryId)
      setCategories((previous) => previous.filter((item) => item.id !== categoryId))
      setError(null)
    } catch {
      setError('Не удалось удалить категорию')
    }
  }, [])

  const moveChannels = useCallback(
    async (placements: ChannelPlacement[]) => {
      if (serverId == null || placements.length === 0) return
      try {
        await categoryService.reorder(serverId, placements)
        setError(null)
      } catch {
        setError('Не удалось изменить порядок каналов')
      }
    },
    [serverId],
  )

  return {
    categories,
    categoriesError: error,
    reloadCategories: reload,
    createCategory,
    renameCategory,
    deleteCategory,
    moveChannels,
  }
}
