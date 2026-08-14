import api from './api'

export type StageRole = 'audience' | 'speaker' | 'moderator'
export interface StageInstance {
  id: number
  channel_id: number
  server_id: number
  owner_id?: number | null
  topic: string
  status: 'active' | 'ended'
  request_to_speak_enabled: boolean
  started_at: string
  ended_at?: string | null
  speaker_count: number
  request_count: number
}
export interface StageRequest {
  user_id: number
  requested_at: string
  user: { id: number; username: string; display_name?: string; avatar_url?: string }
}

class StageService {
  async get(channelId: number): Promise<StageInstance | null> {
    try {
      return (await api.get<StageInstance>(`/api/v1/stage-instances/${channelId}`)).data
    } catch (error: any) {
      if (error?.response?.status === 404) return null
      throw error
    }
  }
  async create(channelId: number, topic: string): Promise<StageInstance> {
    return (await api.post<StageInstance>('/api/v1/stage-instances', {
      channel_id: channelId, topic, request_to_speak_enabled: true,
    })).data
  }
  async end(channelId: number): Promise<void> {
    await api.delete(`/api/v1/stage-instances/${channelId}`)
  }
  async requestToSpeak(channelId: number): Promise<void> {
    await api.put(`/api/v1/stage-instances/${channelId}/requests/@me`)
  }
  async cancelRequest(channelId: number): Promise<void> {
    await api.delete(`/api/v1/stage-instances/${channelId}/requests/@me`)
  }
  async requests(channelId: number): Promise<StageRequest[]> {
    return (await api.get<StageRequest[]>(`/api/v1/stage-instances/${channelId}/requests`)).data
  }
  async setRole(channelId: number, userId: number, role: StageRole): Promise<void> {
    await api.put(`/api/v1/stage-instances/${channelId}/participants/${userId}`, { role })
  }
}

export default new StageService()
