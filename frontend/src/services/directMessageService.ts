import api from './api'
import { DirectMessage, User } from '../types'

class DirectMessageService {
  async getConversations(): Promise<User[]> {
    const response = await api.get<User[]>('api/dms/conversations')
    return response.data
  }

  async getMessages(friendId: number, skip: number = 0, limit: number = 30): Promise<DirectMessage[]> {
    const response = await api.get<DirectMessage[]>(`api/dms/${friendId}?skip=${skip}&limit=${limit}`)
    return response.data
  }

  async sendMessage(friendId: number, content: string): Promise<void> {
    // Теперь отправка через WebSocket
  }
}

const directMessageService = new DirectMessageService()
export default directMessageService
