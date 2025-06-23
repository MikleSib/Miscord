import { Message } from '../types';
import { channelApi } from './api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru';

export type ChatMessageHandler = (msg: Message) => void;

class ChatService {
  private ws: WebSocket | null = null;
  private messageHandler: ChatMessageHandler | null = null;
  private typingHandler: ((data: any) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private channelId: number | null = null;
  private token: string | null = null;
  private isConnecting = false;
  private shouldReconnect = true;

  connect(channelId: number, token: string) {
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
    
    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }
    
    this.channelId = null;
    this.token = null;
    this.reconnectAttempts = 0;
  }

  sendMessage(content: string, attachments: string[] = []) {
    console.log('[ChatService] sendMessage вызван', { 
      content, 
      attachments, 
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