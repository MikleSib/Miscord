import api from './api';

export interface MessageUpdateData {
  content: string;
}

export const messageService = {
  // Удаление сообщения
  async deleteMessage(messageId: number): Promise<void> {
    await api.delete(`/api/v1/channels/messages/${messageId}`);
  },

  // Редактирование сообщения
  async editMessage(messageId: number, data: MessageUpdateData): Promise<any> {
    const response = await api.put(`/api/v1/channels/messages/${messageId}`, data);
    return response.data;
  }
};
