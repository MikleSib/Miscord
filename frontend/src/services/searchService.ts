import api from './api'
import type { Message } from '../types'

export type SearchHasFilter = 'link' | 'file' | 'image'

export interface SearchResultMessage extends Message {
  text_channel_id: number
  channel_name?: string | null
}

export interface MessageSearchResponse {
  query: string
  total: number
  offset: number
  limit: number
  messages: SearchResultMessage[]
}

export interface MessageSearchParams {
  serverId: number
  query: string
  channelId?: number | null
  authorId?: number | null
  has?: SearchHasFilter | null
  offset?: number
  limit?: number
}

class SearchService {
  async searchMessages({
    serverId,
    query,
    channelId,
    authorId,
    has,
    offset = 0,
    limit = 25,
  }: MessageSearchParams): Promise<MessageSearchResponse> {
    const response = await api.get(`/api/v1/channels/${serverId}/messages/search`, {
      params: {
        q: query,
        channel_id: channelId ?? undefined,
        author_id: authorId ?? undefined,
        has: has ?? undefined,
        offset,
        limit,
      },
    })
    return response.data
  }
}

export const searchService = new SearchService()
export default searchService
