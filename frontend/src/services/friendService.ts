import api from './api'
import { User, FriendRequest } from '../types'

function normalizeLogin(value: string): string {
  return value.trim().replace(/^@+/, '')
}

class FriendService {
  async sendFriendRequest(username: string): Promise<User> {
    const login = normalizeLogin(username)
    const response = await api.post<User>('/api/v1/friends/friends/request', { username: login })
    return response.data
  }

  async getFriends(): Promise<User[]> {
    const response = await api.get<User[]>('/api/v1/friends/friends')
    return response.data
  }

  async getPendingRequests(): Promise<any[]> {
    const response = await api.get<any[]>('/api/v1/friends/friends/requests/pending')
    return response.data
  }

  async acceptFriendRequest(requestId: number): Promise<User> {
    const response = await api.post<User>(`/api/v1/friends/friends/accept/${requestId}`)
    return response.data
  }

  async rejectFriendRequest(requestId: number): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>(`/api/v1/friends/friends/reject/${requestId}`)
    return response.data
  }
}

const friendService = new FriendService()
export default friendService
