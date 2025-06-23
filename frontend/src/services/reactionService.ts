import api from './api';

class ReactionService {
  async toggleReaction(messageId: number, emoji: string) {
    try {
      const response = await api.post(`/messages/${messageId}/reactions`, {
        emoji
      });
      return response.data;
    } catch (error) {
      console.error('Ошибка при добавлении/удалении реакции:', error);
      throw error;
    }
  }

  async getMessageReactions(messageId: number) {
    try {
      const response = await api.get(`/messages/${messageId}/reactions`);
      return response.data;
    } catch (error) {
      console.error('Ошибка при получении реакций:', error);
      throw error;
    }
  }
}

export default new ReactionService(); 