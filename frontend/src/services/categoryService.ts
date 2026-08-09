import api from './api'

export interface ChannelCategory {
  id: number
  name: string
  server_id: number
  position: number
}

export interface ChannelPlacement {
  id: number
  type: 'text' | 'voice'
  position: number
  category_id: number | null
}

class CategoryService {
  async list(serverId: number): Promise<ChannelCategory[]> {
    const response = await api.get(`/api/v1/channels/${serverId}/categories`)
    return response.data
  }

  async create(serverId: number, name: string): Promise<ChannelCategory> {
    const response = await api.post(`/api/v1/channels/${serverId}/categories`, { name })
    return response.data
  }

  async rename(categoryId: number, name: string): Promise<ChannelCategory> {
    const response = await api.patch(`/api/v1/channels/categories/${categoryId}`, { name })
    return response.data
  }

  async remove(categoryId: number): Promise<void> {
    await api.delete(`/api/v1/channels/categories/${categoryId}`)
  }

  async reorder(serverId: number, channels: ChannelPlacement[]): Promise<void> {
    await api.patch(`/api/v1/channels/${serverId}/channels/reorder`, { channels })
  }
}

export const categoryService = new CategoryService()
export default categoryService
