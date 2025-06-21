import { Message } from '../types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://195.19.93.203:8000';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private messageHandlers: { [key: string]: (data: any) => void } = {};

  connect(token: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(`${WS_URL}/ws/notifications?token=${token}`);
      
      this.ws.onopen = () => {
        console.log('🔔 WebSocket уведомлений подключен');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('🔔 Получено уведомление:', data);
          
          // Вызываем соответствующий обработчик
          if (data.type && this.messageHandlers[data.type]) {
            this.messageHandlers[data.type](data);
          }
        } catch (error) {
          console.error('Ошибка обработки WebSocket сообщения:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('🔔 WebSocket уведомлений отключен');
        this.handleReconnect(token);
      };

      this.ws.onerror = (error) => {
        console.error('🔔 Ошибка WebSocket уведомлений:', error);
      };
    } catch (error) {
      console.error('Ошибка подключения WebSocket уведомлений:', error);
    }
  }

  private handleReconnect(token: string) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔔 Попытка переподключения ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      setTimeout(() => {
        this.connect(token);
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  // Регистрация обработчиков сообщений
  onChannelInvitation(handler: (data: { channel_id: number; channel_name: string; invited_by: string }) => void) {
    this.messageHandlers['channel_invitation'] = handler;
  }

  onUserJoinedChannel(handler: (data: { user_id: number; username: string; channel_id: number }) => void) {
    this.messageHandlers['user_joined_channel'] = handler;
  }

  onUserLeftChannel(handler: (data: { user_id: number; channel_id: number }) => void) {
    this.messageHandlers['user_left_channel'] = handler;
  }

  onChannelUpdated(handler: (data: { channel_id: number; changes: any }) => void) {
    this.messageHandlers['channel_updated'] = handler;
  }

  // Отправка сообщения
  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // Отключение
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandlers = {};
    this.reconnectAttempts = 0;
  }

  // Проверка состояния подключения
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export default new WebSocketService();