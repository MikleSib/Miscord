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
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private channelId: number | null = null;
  private token: string | null = null;
  private isConnecting = false;
  private shouldReconnect = true;

  connect(channelId: number, token: string) {
    console.log('[ChatService] connect() вызван', { 
      channelId, 
      hasToken: !!token, 
      tokenLength: token?.length,
      currentChannelId: this.channelId,
      wsState: this.ws?.readyState,
      isConnecting: this.isConnecting 
    });
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.channelId === channelId) {
      console.log('[ChatService] Уже подключены к каналу', channelId);
      return;
    }
    
    if (this.isConnecting) {
      console.log('[ChatService] Подключение уже выполняется');
      return;
    }

    this.channelId = channelId;
    this.token = token;
    this.shouldReconnect = true;
    this._connect();
  }

  private _connect() {
    if (!this.channelId || !this.token || this.isConnecting) return;
    
    this.isConnecting = true;
    const url = `${WS_URL}/ws/chat/${this.channelId}?token=${this.token}`;
    
    console.log('[ChatService] Подключаемся к', url);
    
    try {
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log('[ChatService] Подключено к чату канала', this.channelId);
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        
        // Запускаем heartbeat для поддержания активности (каждые 30 секунд)
        this.startHeartbeat();
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'new_message' && this.messageHandler) {
            this.messageHandler(data.data);
          }
          if (data.type === 'typing' && this.typingHandler) {
            this.typingHandler(data);
          }
          if (data.type === 'message_deleted' && this.messageDeletedHandler) {
            this.messageDeletedHandler(data.data);
          }
          if (data.type === 'message_edited' && this.messageEditedHandler) {
            this.messageEditedHandler(data.data);
          }
        } catch (e) {
          console.error('[ChatService] Ошибка обработки сообщения:', e);
        }
      };
      
      this.ws.onclose = (event) => {
        console.log('[ChatService] Соединение закрыто', event.code, event.reason);
        this.isConnecting = false;
        
        if (this.shouldReconnect && event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          console.log('[ChatService] Попытка переподключения через', this.reconnectDelay, 'мс');
          setTimeout(() => {
            if (this.shouldReconnect) {
              this.reconnectAttempts++;
              this._connect();
            }
          }, this.reconnectDelay * (this.reconnectAttempts + 1));
        }
      };
      
      this.ws.onerror = (e) => {
        console.error('[ChatService] Ошибка WebSocket:', e);
        this.isConnecting = false;
      };
      
    } catch (error) {
      console.error('[ChatService] Ошибка создания WebSocket:', error);
      this.isConnecting = false;
    }
  }

  disconnect() {
    console.log('[ChatService] Отключаемся от WebSocket');
    this.shouldReconnect = false;
    this.isConnecting = false;
    
    // Останавливаем heartbeat
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }
    
    this.channelId = null;
    this.token = null;
    this.reconnectAttempts = 0;
  }

  sendMessage(content: string, attachments: string[] = [], replyToId?: number) {
    console.log('[ChatService] sendMessage вызван', { 
      content, 
      attachments, 
      replyToId,
      channelId: this.channelId,
      wsState: this.ws?.readyState,
      wsOpen: this.ws?.readyState === WebSocket.OPEN 
    });
    
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
    
    console.log('[ChatService] Отправляем сообщение через WebSocket:', message);
    try {
      this.ws.send(JSON.stringify(message));
      console.log('[ChatService] Сообщение успешно отправлено');
    } catch (error) {
      console.error('[ChatService] Ошибка отправки сообщения:', error);
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

  private startHeartbeat() {
    // Останавливаем предыдущий heartbeat, если есть
    this.stopHeartbeat();
    
    // Запускаем новый heartbeat каждые 30 секунд
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
      console.error('[ChatService] Ошибка загрузки истории сообщений:', error);
      throw error;
    }
  }
}

export default new ChatService(); 