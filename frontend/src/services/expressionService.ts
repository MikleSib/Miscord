import api from './api'
import uploadService from './uploadService'
import type { MessageGif, ServerExpression } from '../types'

export interface GiphyConfig {
  provider: 'giphy'
  api_key: string
  rating: string
}

class ExpressionService {
  private readonly cache = new Map<number, ServerExpression>()

  async list(serverId?: number, kind?: ServerExpression['kind']): Promise<ServerExpression[]> {
    const path = serverId ? `/api/v1/servers/${serverId}/expressions` : '/api/v1/users/@me/expressions'
    const items = (await api.get<ServerExpression[]>(path, { params: kind ? { kind } : undefined })).data
    items.forEach((item) => this.cache.set(item.id, item))
    return items
  }

  async get(id: number): Promise<ServerExpression> {
    const cached = this.cache.get(id)
    if (cached) return cached
    const item = (await api.get<ServerExpression>(`/api/v1/expressions/${id}`)).data
    this.cache.set(item.id, item)
    return item
  }

  async create(serverId: number, kind: ServerExpression['kind'], name: string, file: File): Promise<ServerExpression> {
    const upload = await uploadService.uploadFile(file)
    let duration_ms: number | undefined
    if (kind === 'sound') duration_ms = await audioDuration(file)
    try {
      const item = (await api.post<ServerExpression>(`/api/v1/servers/${serverId}/expressions`, {
        kind, name, upload_id: upload.upload_id, duration_ms,
      })).data
      this.cache.set(item.id, item)
      return item
    } catch (error) {
      await uploadService.deleteUpload(upload.upload_id).catch(() => undefined)
      throw error
    }
  }

  async remove(serverId: number, id: number): Promise<void> {
    await api.delete(`/api/v1/servers/${serverId}/expressions/${id}`)
    this.cache.delete(id)
  }

  async giphyConfig(): Promise<GiphyConfig> {
    return (await api.get<GiphyConfig>('/api/v1/media/giphy/config')).data
  }

  async searchGiphy(query: string, limit = 24): Promise<MessageGif[]> {
    const config = await this.giphyConfig()
    const endpoint = query.trim() ? 'search' : 'trending'
    const url = new URL(`https://api.giphy.com/v1/gifs/${endpoint}`)
    url.searchParams.set('api_key', config.api_key)
    url.searchParams.set('rating', config.rating)
    url.searchParams.set('limit', String(limit))
    if (query.trim()) url.searchParams.set('q', query.trim())
    const payload = await fetch(url).then((response) => {
      if (!response.ok) throw new Error('GIF-каталог временно недоступен')
      return response.json()
    })
    return (payload.data || []).map((item: any) => ({
      provider: 'giphy', id: String(item.id), title: item.title || null,
      url: item.images?.original?.url,
      preview_url: item.images?.fixed_width_small?.url || item.images?.fixed_width?.url,
      width: Number(item.images?.original?.width || 0) || null,
      height: Number(item.images?.original?.height || 0) || null,
    })).filter((item: MessageGif) => Boolean(item.url))
  }

  async soundboardTicket(channelId: number, soundId: number): Promise<{ ticket: string; sound: ServerExpression }> {
    return (await api.post(`/api/v1/voice/${channelId}/soundboard/${soundId}/ticket`)).data
  }
}

async function audioDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file)
  try {
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.src = url
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve()
      audio.onerror = () => reject(new Error('Не удалось прочитать аудиофайл'))
    })
    return Math.min(5000, Math.max(1, Math.round(audio.duration * 1000)))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default new ExpressionService()
