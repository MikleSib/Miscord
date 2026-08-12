/**
 * Унифицированный WebSocket сервис для всего приложения
 * Единое соединение для: чатов, голоса, уведомлений, P2P звонков
 */

import { Message } from '../types';
import { ConnectionStatus, UNIFIED_WS_URL, UnifiedWebSocketHandler as Handler } from './unifiedWebSocketTypes'

export type { ConnectionStatus } from './unifiedWebSocketTypes'

class UnifiedWebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0; private maxReconnectAttempts = 60;
  private reconnectDelay = 1000; private listeners: Map<string, Set<Handler>> = new Map();
  private isReconnecting = false; private lastError: string | null = null;
  private connectionStatusHandlers: Set<(status: ConnectionStatus) => void> = new Set();
  private token: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private missedHeartbeats = 0; private maxMissedHeartbeats = 3;
  private shouldReconnect = true;
  private seenEventIds = new Set<string>();
  private channelSubscriptions = new Set<number>();

  /**
   * Подключение к WebSocket серверу
   */
  public connect(token: string): void {
    if (typeof window === 'undefined') return;

    this.token = token;
    this.shouldReconnect = true;

    // Если уже подключены, не переподключаемся
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[UnifiedWS] Уже подключен');
      return;
    }

    // Если идет попытка подключения, не делаем еще одну
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      console.log('[UnifiedWS] Подключение уже в процессе');
      return;
    }

    this.isReconnecting = true;
    this.lastError = null;
    this.notifyConnectionStatus();

    try {
      this.ws = new WebSocket(`${UNIFIED_WS_URL}/ws/unified`);
      this.setupWebSocketHandlers();
    } catch (error) {
      console.error('[UnifiedWS] Ошибка создания WebSocket:', error);
      this.lastError = 'Не удалось создать соединение';
      this.isReconnecting = false;
      this.notifyConnectionStatus();
      this.scheduleReconnect();
    }
  }

  /**
   * Настройка обработчиков WebSocket событий
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('[UnifiedWS] ✅ Соединение установлено');
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.lastError = null;
      this.missedHeartbeats = 0;
      this.notifyConnectionStatus();
      this.startHeartbeat();
      this.send({ type: 'identify', token: this.token });
      for (const textChannelId of this.channelSubscriptions) {
        this.send({ type: 'subscribe_channel', text_channel_id: textChannelId });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (typeof data.event_id === 'string') {
          if (this.seenEventIds.has(data.event_id)) return;
          this.seenEventIds.add(data.event_id);
          if (this.seenEventIds.size > 2000) {
            const oldest = this.seenEventIds.values().next().value;
            if (oldest) this.seenEventIds.delete(oldest);
          }
        }

        // Обработка heartbeat
        if (data.type === 'pong' || data.type === 'heartbeat_ack') {
          this.missedHeartbeats = 0;
          return;
        }

        console.log('[UnifiedWS] 📨 Получено:', data.type);
        this.emit(data.type, data);
      } catch (error) {
        console.error('[UnifiedWS] Ошибка парсинга сообщения:', error);
        this.lastError = 'Ошибка обработки сообщения';
        this.notifyConnectionStatus();
      }
    };

    this.ws.onclose = (event) => {
      console.log('[UnifiedWS] 🔌 Соединение закрыто:', event.code, event.reason);
      this.isReconnecting = false;
      this.lastError = event.reason || 'Соединение закрыто';
      this.notifyConnectionStatus();
      this.stopHeartbeat();

      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('[UnifiedWS] ❌ Ошибка WebSocket:', error);
      this.lastError = 'Ошибка соединения';
      this.isReconnecting = false;
      this.notifyConnectionStatus();
    };
  }

  /**
   * Запуск heartbeat для поддержания соединения
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.missedHeartbeats++;

        if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
          console.warn('[UnifiedWS] 💔 Превышено количество пропущенных heartbeat');
          this.ws.close();
          return;
        }

        this.send({ type: 'ping' });
      }
    }, 15000); // Каждые 15 секунд
  }

  /**
   * Остановка heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Планирование переподключения
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.isReconnecting = true;
      this.lastError = `Попытка переподключения ${this.reconnectAttempts}/${this.maxReconnectAttempts}`;
      this.notifyConnectionStatus();

      const delay = Math.min(
        this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
        30000 // Максимум 30 секунд
      );

      console.log(`[UnifiedWS] 🔄 Переподключение через ${delay}ms`);

      setTimeout(() => {
        if (this.token && this.shouldReconnect) {
          this.connect(this.token);
        }
      }, delay);
    } else {
      this.isReconnecting = false;
      this.lastError = 'Превышено максимальное количество попыток переподключения';
      this.notifyConnectionStatus();
    }
  }

  /**
   * Отправка сообщения на сервер
   */
  public send(data: any): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(data);
      this.ws.send(messageStr);
      console.log('[UnifiedWS] 📤 Отправлено:', data.type || 'unknown');
      return true;
    } else {
      console.warn('[UnifiedWS] ⚠️ WebSocket не открыт, сообщение не отправлено:', data.type);
      return false;
    }
  }

  /**
   * Подписка на события
   */
  public on(event: string, handler: Handler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  /**
   * Отписка от событий
   */
  public off(event: string, handler: Handler): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Вызов всех обработчиков события
   */
  private emit(event: string, data: any): void {
    const handlers = this.listeners.get(event);
    if (handlers && handlers.size > 0) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[UnifiedWS] Ошибка в обработчике ${event}:`, error);
        }
      });
    } else {
      console.log(`[UnifiedWS] 🔕 Нет обработчиков для события: ${event}`);
    }
  }

  /**
   * Подписка на изменения статуса соединения
   */
  public onConnectionStatusChange(handler: (status: ConnectionStatus) => void): void {
    this.connectionStatusHandlers.add(handler);
    // Сразу отправляем текущий статус
    this.notifyConnectionStatus();
  }

  /**
   * Отписка от изменений статуса соединения
   */
  public offConnectionStatusChange(handler: (status: ConnectionStatus) => void): void {
    this.connectionStatusHandlers.delete(handler);
  }

  /**
   * Уведомление об изменении статуса соединения
   */
  private notifyConnectionStatus(): void {
    const status: ConnectionStatus = {
      isConnected: this.isConnected(),
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      lastError: this.lastError || undefined
    };

    this.connectionStatusHandlers.forEach(handler => {
      try {
        handler(status);
      } catch (error) {
        console.error('[UnifiedWS] Ошибка в обработчике статуса:', error);
      }
    });
  }

  /**
   * Отключение от WebSocket
   */
  public disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.lastError = null;
    this.notifyConnectionStatus();
  }

  /**
   * Полное отключение с очисткой обработчиков
   */
  public fullDisconnect(): void {
    this.disconnect();
    this.listeners.clear();
    this.connectionStatusHandlers.clear();
    this.seenEventIds.clear();
    this.token = null;
  }

  /**
   * Проверка состояния соединения
   */
  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Получение текущего статуса
   */
  public getStatus(): ConnectionStatus {
    return {
      isConnected: this.isConnected(),
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      lastError: this.lastError || undefined
    };
  }

  // ==================== СПЕЦИАЛИЗИРОВАННЫЕ МЕТОДЫ ====================

  /**
   * Отправка сообщения в текстовый канал
   */
  public sendChatMessage(textChannelId: number, content: string, attachments: string[] = [], replyToId?: number): void {
    this.send({
      type: 'chat_message',
      text_channel_id: textChannelId,
      content,
      attachments,
      reply_to_id: replyToId
    });
  }

  public subscribeChannel(textChannelId: number): void {
    this.channelSubscriptions.add(textChannelId);
    this.send({ type: 'subscribe_channel', text_channel_id: textChannelId });
  }

  public unsubscribeChannel(textChannelId: number): void {
    this.channelSubscriptions.delete(textChannelId);
    this.send({ type: 'unsubscribe_channel', text_channel_id: textChannelId });
  }

  /**
   * Отправка статуса печатания
   */
  public sendTyping(textChannelId: number): void {
    this.send({
      type: 'typing',
      text_channel_id: textChannelId
    });
  }

  /**
   * Присоединение к голосовому каналу
   */
  public joinVoiceChannel(voiceChannelId: number, isMuted = false, isDeafened = false): void {
    this.send({
      type: 'join_voice',
      voice_channel_id: voiceChannelId,
      is_muted: isMuted,
      is_deafened: isDeafened,
    });
  }

  /**
   * Отключение от голосового канала
   */
  public leaveVoiceChannel(voiceChannelId: number): void {
    this.send({
      type: 'leave_voice',
      voice_channel_id: voiceChannelId
    });
  }

  /** Update local microphone state. */
  public updateMuteStatus(voiceChannelId: number, isMuted: boolean): void {
    this.send({
      type: 'voice_mute',
      voice_channel_id: voiceChannelId,
      is_muted: isMuted
    });
  }

  /**
   * Обновление статуса наушников
   */
  public updateDeafenStatus(voiceChannelId: number, isDeafened: boolean): void {
    this.send({
      type: 'voice_deafen',
      voice_channel_id: voiceChannelId,
      is_deafened: isDeafened
    });
  }

  /**
   * Обновление статуса речи (speaking)
   */
  public updateSpeakingStatus(voiceChannelId: number, isSpeaking: boolean): void {
    this.send({
      type: 'voice_speaking',
      voice_channel_id: voiceChannelId,
      is_speaking: isSpeaking
    });
  }

  /**
   * Начало демонстрации экрана
   */
  public startScreenShare(voiceChannelId: number): void {
    this.send({
      type: 'screen_share_start',
      voice_channel_id: voiceChannelId
    });
  }

  /**
   * Остановка демонстрации экрана
   */
  public stopScreenShare(voiceChannelId: number): void {
    this.send({
      type: 'screen_share_stop',
      voice_channel_id: voiceChannelId
    });
  }

  public sendDirectMessage(recipientId: number, content: string): void {
    this.send({
      type: 'dm_message',
      recipient_id: recipientId,
      content
    });
  }

  // ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================

  // Чат события
  public onNewMessage(handler: (message: Message) => void): void {
    this.on('new_message', (data) => handler(data.data || data));
  }

  public onTyping(handler: (data: { user: { id: number; username: string }, text_channel_id: number }) => void): void {
    this.on('typing', handler);
  }

  public onMessageDeleted(handler: (data: { message_id: number; text_channel_id: number }) => void): void {
    this.on('message_deleted', handler);
  }

  public onMessageEdited(handler: (message: Message) => void): void {
    this.on('message_edited', handler);
  }

  public onRateLimit(handler: (data: {
    message?: string;
    retry_after_seconds: number;
    scope?: string;
    text_channel_id?: number;
    recipient_id?: number;
  }) => void): void {
    this.on('rate_limit', handler);
  }

  public onSlowMode(handler: (data: {
    text_channel_id: number;
    retry_after_seconds: number;
  }) => void): void {
    this.on('slow_mode', handler);
  }

  // Голосовые события
  public onVoiceParticipants(handler: (data: { participants: any[]; ice_servers: any[] }) => void): void {
    this.on('voice_participants', handler);
  }

  public onUserJoinedVoice(handler: (data: { user_id: number; username: string; display_name?: string; avatar_url?: string }) => void): void {
    this.on('user_joined_voice', handler);
  }

  public onUserLeftVoice(handler: (data: { user_id: number }) => void): void {
    this.on('user_left_voice', handler);
  }

  public onUserMuted(handler: (data: { user_id: number; is_muted: boolean; server_muted?: boolean }) => void): void {
    this.on('user_muted', handler);
  }

  public onUserDeafened(handler: (data: { user_id: number; is_deafened: boolean; server_deafened?: boolean }) => void): void {
    this.on('user_deafened', handler);
  }

  public onUserSpeaking(handler: (data: { user_id: number; is_speaking: boolean }) => void): void {
    // Каноническое имя с бэкенда + legacy alias
    this.on('voice_speaking', handler);
    this.on('user_speaking', handler);
  }

  public onScreenShareStarted(handler: (data: { user_id: number; username: string }) => void): void {
    this.on('screen_share_started', handler);
  }

  public onScreenShareStopped(handler: (data: { user_id: number; username: string }) => void): void {
    this.on('screen_share_stopped', handler);
  }

  // Канальные события
  public onChannelInvitation(handler: (data: { channel_id: number; channel_name: string; invited_by: string }) => void): void {
    this.on('channel_invitation', handler);
  }

  public onUserJoinedChannel(handler: (data: { user_id: number; username: string; channel_id: number }) => void): void {
    this.on('user_joined_channel', handler);
  }

  public onUserLeftChannel(handler: (data: { user_id: number; channel_id: number }) => void): void {
    this.on('user_left_channel', handler);
  }

  public onChannelUpdated(handler: (data: { channel_id: number; changes: any }) => void): void {
    this.on('channel_updated', handler);
  }

  public onServerCreated(handler: (data: { server: any; created_by?: { id: number; username: string }; invited_by?: string }) => void): void {
    this.on('server_created', handler);
  }

  public onTextChannelCreated(handler: (data: { channel_id: number; text_channel: any; created_by: { id: number; username: string } }) => void): void {
    this.on('text_channel_created', handler);
  }

  public onVoiceChannelCreated(handler: (data: { channel_id: number; voice_channel: any; created_by: { id: number; username: string } }) => void): void {
    this.on('voice_channel_created', handler);
  }

  public onVoiceChannelJoin(handler: (data: { user_id: number; username: string; voice_channel_id: number; voice_channel_name: string }) => void): void {
    this.on('voice_channel_join', handler);
  }

  public onVoiceChannelLeave(handler: (data: { user_id: number; username: string; voice_channel_id: number }) => void): void {
    this.on('voice_channel_leave', handler);
  }

  // Реакции
  public onReactionUpdated(handler: (data: {
    message_id: number;
    emoji: string;
    reaction: any;
    was_removed: boolean;
    user: { id: number; username: string; display_name: string }
  }) => void): void {
    this.on('reaction_updated', handler);
  }

  // Серверные события
  public onServerUpdated(handler: (data: {
    server_id: number;
    name: string;
    description?: string;
    icon?: string;
    updated_by: { id: number; username: string; display_name: string }
  }) => void): void {
    this.on('server_updated', handler);
  }

  public onServerDeleted(handler: (data: {
    server_id: number;
    server_name: string;
    deleted_by: { id: number; username: string }
  }) => void): void {
    this.on('server_deleted', handler);
  }

  // Статус пользователей
  public onUserStatusChanged(handler: (data: { user_id: number; username: string; is_online: boolean }) => void): void {
    this.on('user_status_changed', handler);
  }

  // Direct messages
  public onDirectMessage(handler: (data: any) => void): void {
    this.on('dm', handler);
  }
}

// Экспорт singleton экземпляра
export const unifiedWebSocketService = new UnifiedWebSocketService();
export default unifiedWebSocketService;
