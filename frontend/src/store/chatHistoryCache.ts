import type { Message } from '../types'

export const CHAT_CACHE_MAX_CHANNELS = 24

export interface ChannelHistoryCacheEntry {
  messages: Message[]
  hasMoreOlder: boolean
  loadedOlder: boolean
  lastSyncedAt: number
  lastAccessedAt: number
}

export function dedupeMessages(messages: Message[]): Message[] {
  const seen = new Set<number>()
  return messages.filter((message) => {
    if (seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
}

export function mergeLatestMessagePage(
  cached: ChannelHistoryCacheEntry | undefined,
  page: Message[],
  idsPresentAtRequestStart: ReadonlySet<number>,
): Message[] {
  if (!cached) return dedupeMessages(page)

  const pageIds = new Set(page.map((message) => message.id))
  const firstPageId = page[0]?.id
  const older = cached.loadedOlder && firstPageId != null
    ? cached.messages.filter((message) => message.id < firstPageId)
    : []
  const receivedDuringRequest = cached.messages.filter(
    (message) => !idsPresentAtRequestStart.has(message.id) && !pageIds.has(message.id),
  )

  return dedupeMessages([...older, ...page, ...receivedDuringRequest])
    .sort((left, right) => left.id - right.id)
}

export function writeChannelHistory(
  cache: Record<number, ChannelHistoryCacheEntry>,
  channelId: number,
  entry: ChannelHistoryCacheEntry,
): Record<number, ChannelHistoryCacheEntry> {
  const next = { ...cache, [channelId]: entry }
  const channelIds = Object.keys(next).map(Number)
  if (channelIds.length <= CHAT_CACHE_MAX_CHANNELS) return next

  const oldest = channelIds
    .filter((id) => id !== channelId)
    .sort((left, right) => next[left].lastAccessedAt - next[right].lastAccessedAt)[0]
  if (oldest != null) delete next[oldest]
  return next
}
