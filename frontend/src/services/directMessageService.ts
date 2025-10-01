import api from './api'
import { DirectMessage } from '../types'

class DirectMessageService {
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
