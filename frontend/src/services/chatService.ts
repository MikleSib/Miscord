import { Message } from '../types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru';

export type ChatMessageHandler = (msg: Message) => void;

class ChatService {
  private ws: WebSocket | null = null;
  private messageHandler: ChatMessageHandler | null = null;
  private typingHandler: ((data: any) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private channelId: number | null = null;
  private token: string | null = null;

  connect(channelId: number, token: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.channelId === channelId) {
      return;
    }
    this.channelId = channelId;
    this.token = token;
    this._connect();
  }

  private _connect() {
    if (!this.channelId || !this.token) return;
    const url = `${WS_URL}/ws/chat/${this.channelId}?token=${this.token}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      console.log('[ChatWS] Подключено к чату канала', this.channelId);
      this.reconnectAttempts = 0;
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
        console.error('[ChatWS] Ошибка обработки сообщения:', e);
      }
    };
    this.ws.onclose = () => {
      console.warn('[ChatWS] Соединение закрыто, попытка переподключения...');
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => {
          this.reconnectAttempts++;
          this._connect();
        }, this.reconnectDelay * (this.reconnectAttempts + 1));
      }
    };
    this.ws.onerror = (e) => {
      console.error('[ChatWS] Ошибка WebSocket:', e);
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.channelId = null;
    this.token = null;
  }

  sendMessage(content: string, attachments: string[] = []) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[ChatWS] WebSocket не открыт, сообщение не отправлено');
      return;
    }
    this.ws.send(JSON.stringify({
      type: 'message',
      text_channel_id: this.channelId,
      content,
      attachments,
    }));
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
}

export default new ChatService(); 