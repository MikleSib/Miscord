import api from './api'
import { User } from '../types'

class FriendService {
  async sendFriendRequest(username: string): Promise<User> {
    const response = await api.post<User>('/friends/request', { username })
    return response.data
  }

  async getFriends(): Promise<User[]> {
    const response = await api.get<User[]>('/friends')
    return response.data
  }

  async getPendingRequests(): Promise<User[]> {
    const response = await api.get<User[]>('/friends/requests/pending')
    return response.data
  }

  async acceptFriendRequest(requestId: number): Promise<User> {
    const response = await api.post<User>(`/friends/accept/${requestId}`)
    return response.data
  }

  async rejectFriendRequest(requestId: number): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>(`/friends/reject/${requestId}`)
    return response.data
  }
}

const friendService = new FriendService()
export default friendService
