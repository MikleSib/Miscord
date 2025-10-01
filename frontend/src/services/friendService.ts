import api from './api'
import { User, FriendRequest } from '../types'

class FriendService {
  async sendFriendRequest(username: string): Promise<User> {
    const response = await api.post<User>('/api/friends/friends/request', { username })
    return response.data
  }

  async getFriends(): Promise<User[]> {
    const response = await api.get<User[]>('/api/friends/friends')
    return response.data
  }

  async getPendingRequests(): Promise<FriendRequest[]> {
    const response = await api.get<FriendRequest[]>('/api/friends/friends/requests/pending')
    return response.data
  }

  async acceptFriendRequest(requestId: number): Promise<User> {
    const response = await api.post<User>(`/api/friends/friends/accept/${requestId}`)
    return response.data
  }

  async rejectFriendRequest(requestId: number): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>(`/api/friends/friends/reject/${requestId}`)
    return response.data
  }
}

const friendService = new FriendService()
export default friendService
