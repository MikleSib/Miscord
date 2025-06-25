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
  private currentToken: string | null = null;
  private isDisconnecting = false;

  private notifyConnectionStatus() {
    const status = {
      isConnected: this.isConnected(),
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      lastError: this.lastError || undefined
    };
    
    console.log('🔔 WebSocket статус изменен:', status);
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
    // Если уже подключены с тем же токеном, не создаем новое соединение
    if (this.ws?.readyState === WebSocket.OPEN && this.currentToken === token) {
      console.log('🔔 WebSocket уже подключен с этим токеном, пропускаем');
      return;
    }

    // Закрываем предыдущее соединение если есть
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      console.log('🔔 Закрываем предыдущее WebSocket соединение');
      this.isDisconnecting = true;
      this.ws.close(1000, 'Переподключение');
    }

    this.currentToken = token;
    this.isReconnecting = true;
    this.isDisconnecting = false;
    this.lastError = null;
    this.notifyConnectionStatus();

    try {
      console.log('🔔 Создаем новое WebSocket соединение для уведомлений');
      this.ws = new WebSocket(`${WS_URL}/ws/notifications?token=${token}`);
      
      this.ws.onopen = () => {
        console.log('🔔 WebSocket уведомлений подключен успешно');
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.isDisconnecting = false;
        this.lastError = null;
        this.notifyConnectionStatus();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('🔔 Получено уведомление WebSocket:', data);
          
          // Вызываем соответствующий обработчик
          if (data.type && this.messageHandlers[data.type]) {
            this.messageHandlers[data.type](data);
          }
        } catch (error) {
          console.error('❌ Ошибка обработки WebSocket сообщения:', error);
          this.lastError = 'Ошибка обработки сообщения';
          this.notifyConnectionStatus();
        }
      };

      this.ws.onclose = (event) => {
        console.log('🔔 WebSocket уведомлений отключен:', { 
          code: event.code, 
          reason: event.reason,
          wasClean: event.wasClean,
          isDisconnecting: this.isDisconnecting 
        });
        
        // Не переподключаемся если это было намеренное отключение
        if (!this.isDisconnecting) {
          this.isReconnecting = false;
          this.lastError = event.reason || 'Соединение закрыто';
          this.notifyConnectionStatus();
          this.handleReconnect(token);
        } else {
          console.log('🔔 Намеренное отключение, переподключение не требуется');
          this.isReconnecting = false;
          this.notifyConnectionStatus();
        }
      };

      this.ws.onerror = (error) => {
        console.error('❌ Ошибка WebSocket уведомлений:', error);
        this.lastError = 'Ошибка соединения';
        this.isReconnecting = false;
        this.notifyConnectionStatus();
      };
    } catch (error) {
      console.error('❌ Ошибка создания WebSocket уведомлений:', error);
      this.lastError = 'Не удалось подключиться';
      this.isReconnecting = false;
      this.notifyConnectionStatus();
    }
  }

  private handleReconnect(token: string) {
    if (this.isDisconnecting) {
      console.log('🔔 Пропускаем переподключение - идет отключение');
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.isReconnecting = true;
      this.lastError = `Попытка ${this.reconnectAttempts}/${this.maxReconnectAttempts}`;
      this.notifyConnectionStatus();
      
      console.log(`🔄 Попытка переподключения WebSocket ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      setTimeout(() => {
        if (!this.isDisconnecting) {
          this.connect(token);
        }
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

  // Голосовые уведомления
  onVoiceChannelJoin(handler: (data: { user_id: number; username: string; voice_channel_id: number; voice_channel_name: string }) => void) {
    this.messageHandlers['voice_channel_join'] = handler;
  }

  onVoiceChannelLeave(handler: (data: { user_id: number; username: string; voice_channel_id: number }) => void) {
    this.messageHandlers['voice_channel_leave'] = handler;
  }

  // Демонстрация экрана
  onScreenShareStarted(handler: (data: { user_id: number; username: string }) => void) {
    this.messageHandlers['screen_share_started'] = handler;
  }

  onScreenShareStopped(handler: (data: { user_id: number; username: string }) => void) {
    this.messageHandlers['screen_share_stopped'] = handler;
  }

  // Отправка сообщения
  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('🔔 Отправляем WebSocket сообщение:', data);
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('⚠️ Попытка отправить сообщение через закрытое WebSocket соединение');
    }
  }

  // Отключение
  disconnect() {
    console.log('🔔 Начинаем отключение WebSocket сервиса');
    this.isDisconnecting = true;
    
    if (this.ws) {
      // Сначала меняем состояние, чтобы предотвратить переподключения
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Намеренное отключение');
      }
      this.ws = null;
    }
    
    // Очищаем все обработчики и состояние
    this.messageHandlers = {};
    this.connectionStatusHandlers = [];
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.lastError = null;
    this.currentToken = null;
    
    console.log('🔔 WebSocket сервис полностью отключен и очищен');
  }

  // Проверка состояния подключения
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Получение отладочной информации
  getDebugInfo() {
    return {
      readyState: this.ws?.readyState,
      readyStateText: this.ws?.readyState === WebSocket.CONNECTING ? 'CONNECTING' :
                     this.ws?.readyState === WebSocket.OPEN ? 'OPEN' :
                     this.ws?.readyState === WebSocket.CLOSING ? 'CLOSING' :
                     this.ws?.readyState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN',
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
      currentToken: this.currentToken ? 'установлен' : 'не установлен',
      handlersCount: Object.keys(this.messageHandlers).length,
      statusHandlersCount: this.connectionStatusHandlers.length
    };
  }
}

export default new WebSocketService();