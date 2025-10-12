import { Message } from '../types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru';

type Handler = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 60;
  private reconnectDelay = 1000;
  private listeners: { [key: string]: Handler[] } = {};
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

  onConnectionStatusChange(handler: (status: {
    isConnected: boolean;
    isReconnecting: boolean;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    lastError?: string;
  }) => void) {
    this.connectionStatusHandlers.push(handler);
    this.notifyConnectionStatus();
  }

  // Регистрация обработчиков сообщений
  onChannelInvitation(handler: (data: { channel_id: number; channel_name: string; invited_by: string }) => void) {
    this.on('channel_invitation', handler);
  }

  onUserJoinedChannel(handler: (data: { user_id: number; username: string; channel_id: number }) => void) {
    this.on('user_joined_channel', handler);
  }

  onUserLeftChannel(handler: (data: { user_id: number; channel_id: number }) => void) {
    this.on('user_left_channel', handler);
  }

  onChannelUpdated(handler: (data: { channel_id: number; changes: any }) => void) {
    this.on('channel_updated', handler);
  }

  // Новые обработчики для создания каналов
  onServerCreated(handler: (data: { server: any; created_by?: { id: number; username: string }; invited_by?: string }) => void) {
    this.on('server_created', handler);
  }

  onTextChannelCreated(handler: (data: { channel_id: number; text_channel: any; created_by: { id: number; username: string } }) => void) {
    this.on('text_channel_created', handler);
  }

  onVoiceChannelCreated(handler: (data: { channel_id: number; voice_channel: any; created_by: { id: number; username: string } }) => void) {
    this.on('voice_channel_created', handler);
  }

  // Голосовые уведомления
  onVoiceChannelJoin(handler: (data: { user_id: number; username: string; voice_channel_id: number; voice_channel_name: string }) => void) {
    this.on('voice_channel_join', handler);
  }

  onVoiceChannelLeave(handler: (data: { user_id: number; username: string; voice_channel_id: number }) => void) {
    this.on('voice_channel_leave', handler);
  }

  onNewMessage(handler: (message: Message) => void) {
    this.on('new_message', handler);
  }

  onTyping(handler: (data: { user: { id: number; username: string }, text_channel_id: number }) => void) {
    this.on('typing', handler);
  }

  onMessageDeleted(handler: (data: { message_id: number; text_channel_id: number }) => void) {
    this.on('message_deleted', handler);
  }

  onMessageEdited(handler: (message: Message) => void) {
    this.on('message_edited', handler);
  }

  // Демонстрация экрана
  onScreenShareStarted(handler: (data: { user_id: number; username: string }) => void) {
    this.on('screen_share_started', handler);
  }

  onScreenShareStopped(handler: (data: { user_id: number; username: string }) => void) {
    this.on('screen_share_stopped', handler);
  }

  // Реакции
  onReactionUpdated(handler: (data: { 
    message_id: number; 
    emoji: string; 
    reaction: any; 
    was_removed: boolean; 
    user: { id: number; username: string; display_name: string } 
  }) => void) {
    this.on('reaction_updated', handler);
  }

  // Обновление сервера
  onServerUpdated(handler: (data: { 
    server_id: number; 
    name: string; 
    description?: string; 
    icon?: string; 
    updated_by: { id: number; username: string; display_name: string } 
  }) => void) {
    this.on('server_updated', handler);
  }

  // Удаление сервера
  onServerDeleted(handler: (data: { 
    server_id: number; 
    server_name: string; 
    deleted_by: { id: number; username: string } 
  }) => void) {
    this.on('server_deleted', handler);
  }

  onUserStatusChanged(handler: (data: { user_id: number; username: string; is_online: boolean }) => void) {
    this.on('user_status_changed', handler);
  }

  // P2P call events
  onP2PIncomingCall(handler: (data: { caller: any }) => void) {
    this.on('p2p-incoming-call', handler);
  }

  onP2PCallAccepted(handler: (data: { recipient: any }) => void) {
    this.on('p2p-call-accepted', handler);
  }

  onP2PCallDeclined(handler: (data: { recipient: any }) => void) {
    this.on('p2p-call-declined', handler);
  }

  onP2PCallEnded(handler: () => void) {
    this.on('p2p-call-ended', handler);
  }

  onP2PAcceptCall(handler: (data: { to: number; from: any }) => void) {
    this.on('p2p-accept-call', handler);
  }

  onP2PIceCandidate(handler: (data: { from: number; candidate: RTCIceCandidateInit }) => void) {
    this.on('p2p-ice-candidate', handler);
  }

  connect(token: string) {
    if (typeof window === 'undefined' || this.ws?.readyState === WebSocket.OPEN) {
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
          console.log('[WS] Получено сообщение:', data);
          
          // Автоматически отвечаем на ping
          if (data.type === 'ping') {
            this.send({ type: 'pong' });
            return;
          }
          
          this.emit(data.type, data);
        } catch (error) {
          console.error('Ошибка обработки WebSocket сообщения:', error);
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
        console.error('🔔 Ошибка WebSocket уведомлений:', error);
        this.lastError = 'Ошибка соединения';
        this.isReconnecting = false;
        this.notifyConnectionStatus();
      };
    } catch (error) {
      console.error('Ошибка подключения WebSocket уведомлений:', error);
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
      setTimeout(() => this.connect(token), this.reconnectDelay * this.reconnectAttempts);
    } else {
      this.isReconnecting = false;
      this.lastError = 'Превышено максимальное количество попыток переподключения';
      this.notifyConnectionStatus();
    }
  }

  on(event: string, handler: Handler) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(handler);
  }

  off(event: string, handler: Handler) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(h => h !== handler);
    }
  }

  private emit(event: string, data: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(handler => handler(data));
    } else {
        console.log('🔔 Нет обработчика для типа:', event);
    }
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(data);
      console.log('[WS] Отправка сообщения:', messageStr);
      this.ws.send(messageStr);
    } else {
      console.warn('[WS] WebSocket не открыт, сообщение не отправлено:', data);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    // НЕ очищаем listeners и connectionStatusHandlers!
    // Они нужны при переподключении
    // this.listeners = {};
    // this.connectionStatusHandlers = [];
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.lastError = null;
  }

  // Новый метод для полного отключения (при выходе из приложения)
  fullDisconnect() {
    this.disconnect();
    this.listeners = {};
    this.connectionStatusHandlers = [];
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export default new WebSocketService();
