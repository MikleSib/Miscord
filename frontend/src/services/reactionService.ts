import api from './api';

class ReactionService {
  async toggleReaction(messageId: number, emoji: string) {
    try {
      const response = await api.post(`/api/messages/${messageId}/reactions`, {
        emoji
      });
      return response.data;
    } catch (error) {
   
      throw error;
    }
  }

  async getMessageReactions(messageId: number) {
    try {
      const response = await api.get(`/api/messages/${messageId}/reactions`);
      return response.data;
    } catch (error) {
    
      throw error;
    }
  }
}

export default new ReactionService(); 