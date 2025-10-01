import api from './api'
import { Message } from '../types'

class DirectMessageService {
  async getMessages(friendId: number): Promise<Message[]> {
    const response = await api.get<Message[]>(`/api/dms/${friendId}`)
    return response.data
  }

  async sendMessage(friendId: number, content: string): Promise<Message> {
    const response = await api.post<Message>(`/api/dms/${friendId}`, { content })
    return response.data
  }
}

const directMessageService = new DirectMessageService()
export default directMessageService
