import api from './api'
import { LinkEmbed } from '../types'

export async function fetchLinkEmbed(url: string): Promise<LinkEmbed | null> {
  try {
    const response = await api.get<LinkEmbed>('/api/embeds/preview', {
      params: { url },
    })
    return response.data
  } catch {
    return null
  }
}
