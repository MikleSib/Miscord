import { Message } from '../types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 60;
  private reconnectDelay = 1000;
  private messageHandlers: { [key: string]: (data: any) => void } = {};
  private isReconnecting = false;
  private lastError: string | null = null;
  private connectionStatusHandlers: ((status: {
    isConnected: boolean;
    isReconnecting: boolean;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    lastError?: string;
  }) => void)[] = [];

  private notifyConnectionStatus() {
    const status = {
      isConnected: this.isConnected(),
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      lastError: this.lastError || undefined
    };
    
    this.connectionStatusHandlers.forEach(handler => handler(status));
  }

  // Подписка на изменения статуса подключения
  onConnectionStatusChange(handler: (status: {
    isConnected: boolean;
    isReconnecting: boolean;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    lastError?: string;
  }) => void) {
    this.connectionStatusHandlers.push(handler);
    
    // Сразу уведомляем о текущем статусе
    this.notifyConnectionStatus();
  }

  connect(token: string) {
    if (typeof window === 'undefined') {
      return; // Не подключаемся на сервере
    }
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isReconnecting = true;
    this.lastError = null;
    this.notifyConnectionStatus();

    try {
      this.ws = new WebSocket(`${WS_URL}/ws/notifications?token=${token}`);
      
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.lastError = null;
        this.notifyConnectionStatus();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Убираем обработку сообщений чата - за это отвечает chatService
          // Оставляем только обработку уведомлений (создание каналов, серверов и т.д.)

          // Вызываем соответствующий обработчик
          if (data.type && this.messageHandlers[data.type]) {
            this.messageHandlers[data.type](data);
          }
        } catch (error) {
          this.lastError = 'Ошибка обработки сообщения';
          this.notifyConnectionStatus();
        }
      };

      this.ws.onclose = (event) => {
        this.isReconnecting = false;
        this.lastError = event.reason || 'Соединение закрыто';
        this.notifyConnectionStatus();
        this.handleReconnect(token);
      };

      this.ws.onerror = (error) => {
        this.lastError = 'Ошибка соединения';
        this.isReconnecting = false;
        this.notifyConnectionStatus();
      };
    } catch (error) {
      this.lastError = 'Не удалось подключиться';
      this.isReconnecting = false;
      this.notifyConnectionStatus();
    }
  }

  private handleReconnect(token: string) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.isReconnecting = true;
      this.lastError = `Попытка ${this.reconnectAttempts}/${this.maxReconnectAttempts}`;
      this.notifyConnectionStatus();
      

      
      setTimeout(() => {
        this.connect(token);
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      this.isReconnecting = false;
      this.lastError = 'Превышено максимальное количество попыток переподключения';
      this.notifyConnectionStatus();
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

  // Новые обработчики для создания каналов
  onServerCreated(handler: (data: { server: any; created_by: { id: number; username: string } }) => void) {
    this.messageHandlers['server_created'] = handler;
  }

  onTextChannelCreated(handler: (data: { channel_id: number; text_channel: any; created_by: { id: number; username: string } }) => void) {
    this.messageHandlers['text_channel_created'] = handler;
  }

  onVoiceChannelCreated(handler: (data: { channel_id: number; voice_channel: any; created_by: { id: number; username: string } }) => void) {
    this.messageHandlers['voice_channel_created'] = handler;
  }

  // Голосовые уведомления
  onVoiceChannelJoin(handler: (data: { user_id: number; username: string; voice_channel_id: number; voice_channel_name: string }) => void) {
    this.messageHandlers['voice_channel_join'] = handler;
  }

  onVoiceChannelLeave(handler: (data: { user_id: number; username: string; voice_channel_id: number }) => void) {
    this.messageHandlers['voice_channel_leave'] = handler;
  }

  onNewMessage(handler: (message: Message) => void) {
    this.messageHandlers['new_message'] = handler;
  }

  onTyping(handler: (data: { user: { id: number; username: string }, text_channel_id: number }) => void) {
    this.messageHandlers['typing'] = handler;
  }

  onMessageDeleted(handler: (data: { message_id: number; text_channel_id: number }) => void) {
    this.messageHandlers['message_deleted'] = handler;
  }

  onMessageEdited(handler: (message: Message) => void) {
    this.messageHandlers['message_edited'] = handler;
  }

  // Демонстрация экрана
  onScreenShareStarted(handler: (data: { user_id: number; username: string }) => void) {
    this.messageHandlers['screen_share_started'] = handler;
  }

  onScreenShareStopped(handler: (data: { user_id: number; username: string }) => void) {
    this.messageHandlers['screen_share_stopped'] = handler;
  }

  // Реакции
  onReactionUpdated(handler: (data: { 
    message_id: number; 
    emoji: string; 
    reaction: any; 
    was_removed: boolean; 
    user: { id: number; username: string; display_name: string } 
  }) => void) {
    this.messageHandlers['reaction_updated'] = handler;
  }

  // Обновление сервера
  onServerUpdated(handler: (data: { 
    server_id: number; 
    name: string; 
    description?: string; 
    icon?: string; 
    updated_by: { id: number; username: string; display_name: string } 
  }) => void) {
    this.messageHandlers['server_updated'] = handler;
  }

  // Удаление сервера
  onServerDeleted(handler: (data: { 
    server_id: number; 
    server_name: string; 
    deleted_by: { id: number; username: string } 
  }) => void) {
    this.messageHandlers['server_deleted'] = handler;
  }

  onUserStatusChanged(handler: (data: { user_id: number; username: string; is_online: boolean }) => void) {
    this.messageHandlers['user_status_changed'] = handler;
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
    this.connectionStatusHandlers = [];
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.lastError = null;
  }

  // Проверка состояния подключения
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export default new WebSocketService();