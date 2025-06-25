import { Message } from '../types';
import { channelApi } from './api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru';

export type ChatMessageHandler = (msg: Message) => void;

class ChatService {
  private ws: WebSocket | null = null;
  private messageHandler: ChatMessageHandler | null = null;
  private typingHandler: ((data: any) => void) | null = null;
  private messageDeletedHandler: ((data: { message_id: number; text_channel_id: number }) => void) | null = null;
  private messageEditedHandler: ChatMessageHandler | null = null;
  private reactionUpdatedHandler: ((data: { 
    message_id: number; 
    emoji: string; 
    reaction: any; 
    was_removed: boolean; 
    user: { id: number; username: string; display_name: string } 
  }) => void) | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private channelId: number | null = null;
  private token: string | null = null;
  private isConnecting = false;
  private shouldReconnect = true;
  private pendingDisconnect = false; // Флаг для отложенного отключения

  connect(channelId: number, token: string) {
    console.log(`[ChatService] Запрос подключения к каналу ${channelId}`);
    
    // Если уже подключены к этому каналу, ничего не делаем
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.channelId === channelId) {
      console.log(`[ChatService] Уже подключены к каналу ${channelId}`);
      return;
    }
    
    if (this.isConnecting) {
      console.log(`[ChatService] Уже происходит подключение, игнорируем запрос`);
      return;
    }

    // Отключаемся от предыдущего канала если нужно
    if (this.channelId !== null && this.channelId !== channelId) {
      console.log(`[ChatService] Отключаемся от предыдущего канала ${this.channelId}`);
      this._disconnect(false); // Не сбрасываем флаги
    }

    this.channelId = channelId;
    this.token = token;
    this.shouldReconnect = true;
    this.pendingDisconnect = false;
    this._connect();
  }

  private _connect() {
    if (!this.channelId || !this.token || this.isConnecting || this.pendingDisconnect) return;
    
    this.isConnecting = true;
    const url = `${WS_URL}/ws/chat/${this.channelId}?token=${this.token}`;
    
    console.log(`[ChatService] Подключаемся к ${url}`);
    
    try {
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log(`[ChatService] Успешно подключились к каналу ${this.channelId}`);
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        
        // Запускаем heartbeat для поддержания активности (каждые 30 секунд)
        this.startHeartbeat();
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'new_message' && this.messageHandler) {
            console.log(`[ChatService] Получено новое сообщение в канале ${this.channelId}:`, data.data);
            this.messageHandler(data.data);
          }
          if (data.type === 'typing' && this.typingHandler) {
            this.typingHandler(data);
          }
          if (data.type === 'message_deleted' && this.messageDeletedHandler) {
            console.log(`[ChatService] Сообщение удалено:`, data.data);
            this.messageDeletedHandler(data.data);
          }
          if (data.type === 'message_edited' && this.messageEditedHandler) {
            console.log(`[ChatService] Сообщение отредактировано:`, data.data);
            this.messageEditedHandler(data.data);
          }
          if (data.type === 'reaction_updated' && this.reactionUpdatedHandler) {
            this.reactionUpdatedHandler(data.data);
          }
          if (data.type === 'heartbeat_ack') {
            // Heartbeat получен, соединение активно
          }
        } catch (e) {
          console.error(`[ChatService] Ошибка парсинга сообщения:`, e);
        }
      };
      
      this.ws.onclose = (event) => {
        console.log(`[ChatService] Соединение закрыто. Код: ${event.code}, причина: ${event.reason}`);
        this.isConnecting = false;
        this.stopHeartbeat();
        
        // Переподключаемся только если это не было принудительное отключение
        if (this.shouldReconnect && !this.pendingDisconnect && event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          console.log(`[ChatService] Пытаемся переподключиться (попытка ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
          setTimeout(() => {
            if (this.shouldReconnect && !this.pendingDisconnect) {
              this.reconnectAttempts++;
              this._connect();
            }
          }, this.reconnectDelay * (this.reconnectAttempts + 1));
        } else {
          console.log(`[ChatService] Переподключение не требуется или достигнут лимит попыток`);
        }
      };
      
      this.ws.onerror = (e) => {
        console.error(`[ChatService] Ошибка WebSocket:`, e);
        this.isConnecting = false;
      };
      
    } catch (error) {
      console.error(`[ChatService] Ошибка создания WebSocket:`, error);
      this.isConnecting = false;
    }
  }

  disconnect() {
    console.log(`[ChatService] Инициируем отключение от канала ${this.channelId}`);
    this._disconnect(true);
  }

  private _disconnect(resetState: boolean = true) {
    this.pendingDisconnect = true;
    this.shouldReconnect = false;
    this.isConnecting = false;
    
    // Останавливаем heartbeat
    this.stopHeartbeat();
    
    if (this.ws) {
      console.log(`[ChatService] Закрываем WebSocket соединение`);
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Manual disconnect');
      }
      this.ws = null;
    }
    
    if (resetState) {
      this.channelId = null;
      this.token = null;
      this.reconnectAttempts = 0;
      this.pendingDisconnect = false;
    }
    
    console.log(`[ChatService] Отключение завершено`);
  }

  sendMessage(content: string, attachments: string[] = [], replyToId?: number) {
    console.log(`[ChatService] Отправляем сообщение в канал ${this.channelId}: "${content}", файлов: ${attachments.length}`);
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[ChatService] WebSocket не открыт, сообщение не отправлено', {
        ws: !!this.ws,
        readyState: this.ws?.readyState,
        CONNECTING: WebSocket.CONNECTING,
        OPEN: WebSocket.OPEN,
        CLOSING: WebSocket.CLOSING,
        CLOSED: WebSocket.CLOSED
      });
      return;
    }
    
    const message = {
      type: 'message',
      text_channel_id: this.channelId,
      content,
      attachments,
      ...(replyToId && { reply_to_id: replyToId }),
    };
    
    console.log(`[ChatService] Отправляем WebSocket сообщение:`, message);
    try {
      this.ws.send(JSON.stringify(message));
      console.log(`[ChatService] Сообщение успешно отправлено`);
    } catch (error) {
      console.error(`[ChatService] Ошибка отправки сообщения:`, error);
    }
  }

  sendTyping() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.ws.send(JSON.stringify({
      type: 'typing',
      text_channel_id: this.channelId,
    }));
  }

  onMessage(handler: ChatMessageHandler) {
    this.messageHandler = handler;
  }

  onTyping(handler: (data: any) => void) {
    this.typingHandler = handler;
  }

  onMessageDeleted(handler: (data: { message_id: number; text_channel_id: number }) => void) {
    this.messageDeletedHandler = handler;
  }

  onMessageEdited(handler: ChatMessageHandler) {
    this.messageEditedHandler = handler;
  }

  onReactionUpdated(handler: (data: { 
    message_id: number; 
    emoji: string; 
    reaction: any; 
    was_removed: boolean; 
    user: { id: number; username: string; display_name: string } 
  }) => void) {
    this.reactionUpdatedHandler = handler;
  }

  private startHeartbeat() {
    // Останавливаем предыдущий heartbeat, если есть
    this.stopHeartbeat();
    
    // Запускаем новый heartbeat каждые 30 секунд
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log(`[ChatService] Отправляем heartbeat для канала ${this.channelId}`);
        this.ws.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async loadMessageHistory(channelId: number, limit = 50, before?: number) {
    try {
      const result = await channelApi.getChannelMessages(channelId, limit, before);
      return result;
    } catch (error) {
      console.error(`[ChatService] Ошибка загрузки истории сообщений:`, error);
      throw error;
    }
  }

  // Метод для получения текущего состояния
  getConnectionState() {
    return {
      isConnected: this.ws?.readyState === WebSocket.OPEN,
      channelId: this.channelId,
      isConnecting: this.isConnecting,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

export default new ChatService(); 