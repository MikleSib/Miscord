import type { ChannelCategory } from '../../services/categoryService'

export type CategoriesByServer = Record<number, ChannelCategory[]>
export type CategoryErrorsByServer = Record<number, string | undefined>

export function resolveCategoryLoadView(
  serverId: number | null,
  categoriesByServer: CategoriesByServer,
  errorsByServer: CategoryErrorsByServer,
) {
  const ready = serverId == null || Object.hasOwn(categoriesByServer, serverId)
  const error = serverId == null ? null : (errorsByServer[serverId] ?? null)

  return {
    categories: serverId == null ? [] : (categoriesByServer[serverId] ?? []),
    ready,
    loading: serverId != null && !ready && error == null,
    error,
  }
}
