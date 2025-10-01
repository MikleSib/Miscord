import api from './api'
import { Message } from '../types'

class DirectMessageService {
  async getMessages(friendId: number): Promise<Message[]> {
    const response = await api.get<Message[]>(`api/dms/dm/${friendId}`)
    return response.data
  }

  async sendMessage(friendId: number, content: string): Promise<void> {
    // Теперь отправка через WebSocket
  }
}

const directMessageService = new DirectMessageService()
export default directMessageService
