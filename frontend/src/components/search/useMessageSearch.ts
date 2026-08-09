'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import searchService, {
  type MessageSearchResponse,
  type SearchHasFilter,
} from '../../services/searchService'

const DEBOUNCE_MS = 350
const PAGE_SIZE = 25

export interface SearchFilters {
  channelId: number | null
  has: SearchHasFilter | null
}

export function useMessageSearch(serverId: number | null) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>({ channelId: null, has: null })
  const [result, setResult] = useState<MessageSearchResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const run = useCallback(
    async (offset: number) => {
      if (serverId == null || query.trim().length < 2) {
        setResult(null)
        setError(null)
        return
      }

      const requestId = ++requestIdRef.current
      setIsLoading(true)
      try {
        const data = await searchService.searchMessages({
          serverId,
          query: query.trim(),
          channelId: filters.channelId,
          has: filters.has,
          offset,
          limit: PAGE_SIZE,
        })
        if (requestId !== requestIdRef.current) return
        setResult(data)
        setError(null)
      } catch (requestError) {
        if (requestId !== requestIdRef.current) return
        const status = (requestError as { response?: { status?: number } }).response?.status
        setError(
          status === 429
            ? 'Слишком много запросов, подождите немного'
            : 'Не удалось выполнить поиск',
        )
        setResult(null)
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false)
      }
    },
    [filters.channelId, filters.has, query, serverId],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void run(0), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [run])

  const goToPage = useCallback((offset: number) => void run(offset), [run])

  const reset = useCallback(() => {
    requestIdRef.current += 1
    setQuery('')
    setFilters({ channelId: null, has: null })
    setResult(null)
    setError(null)
    setIsLoading(false)
  }, [])

  return {
    query,
    setQuery,
    filters,
    setFilters,
    result,
    isLoading,
    error,
    goToPage,
    reset,
    pageSize: PAGE_SIZE,
  }
}
