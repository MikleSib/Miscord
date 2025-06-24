/**
 * 🚀 Enhanced WebSocket Service
 * Enterprise-level client для 1000+ пользователей
 * 
 * Объединяет:
 * - Сообщения чата
 * - Уведомления (приглашения, создание каналов/серверов)
 * - Статусы пользователей
 * - Реакции на сообщения
 * - Типинг статусы
 * 
 * Возможности:
 * - Автоматическое переподключение с exponential backoff
 * - Батчинг сообщений
 * - Приоритизация сообщений
 * - Мониторинг производительности
 * - Оффлайн поддержка с очередью
 */

import { Message, User, Server, Channel } from '../types';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

interface QueuedMessage {
  id: string;
  data: WebSocketMessage;
  priority: number; // 1=low, 2=normal, 3=high
  timestamp: number;
  retries: number;
}

interface ConnectionMetrics {
  totalMessages: number;
  messagesPerSecond: number;
  averageLatency: number;
  reconnectionAttempts: number;
  lastReconnect: number;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'disconnected';
  bytesReceived: number;
  bytesSent: number;
}

interface BatchedMessages {
  type: 'batch';
  messages: WebSocketMessage[];
  timestamp: number;
}

class EnhancedWebSocketService {
  private ws: WebSocket | null = null;
  private url: string = '';
  private token: string = '';
  private isConnecting: boolean = false;
  private isDestroyed: boolean = false;
  
  // Reconnection logic
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private baseReconnectDelay: number = 1000; // 1 second
  private maxReconnectDelay: number = 30000; // 30 seconds
  private reconnectTimeout: NodeJS.Timeout | null = null;
  
  // Message queue for offline support
  private messageQueue: Map<string, QueuedMessage> = new Map();
  private maxQueueSize: number = 1000;
  
  // Performance monitoring
  private metrics: ConnectionMetrics = {
    totalMessages: 0,
    messagesPerSecond: 0,
    averageLatency: 0,
    reconnectionAttempts: 0,
    lastReconnect: 0,
    connectionQuality: 'disconnected',
    bytesReceived: 0,
    bytesSent: 0
  };
  
  // Message handlers
  private messageHandlers: Map<string, ((data: any) => void)[]> = new Map();
  
  // Connection status handlers
  private connectionStatusHandlers: ((status: string) => void)[] = [];
  
  // Performance monitoring
  private lastMessageTime: number = 0;
  private messageCount: number = 0;
  private latencyMeasurements: number[] = [];
  
  // Heartbeat
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastPongTime: number = 0;
  
  constructor() {
    this.startPerformanceMonitoring();
  }

  /**
   * 🔌 Подключение к WebSocket серверу
   */
  async connect(token: string): Promise<boolean> {
    console.log('[EnhancedWS] connect() called', {
      isConnecting: this.isConnecting,
      isDestroyed: this.isDestroyed,
      isCurrentlyConnected: this.isConnected(),
      currentWsState: this.ws?.readyState,
      currentToken: this.token ? `${this.token.substring(0, 20)}...` : 'NO_TOKEN',
      newToken: token ? `${token.substring(0, 20)}...` : 'NO_TOKEN'
    });
    
    // Если уже подключены с тем же токеном, возвращаем true
    if (this.isConnected() && this.token === token) {
      console.log('[EnhancedWS] Already connected with same token, reusing connection');
      return true;
    }
    
    // Если подключены с другим токеном, отключаемся сначала
    if (this.isConnected() && this.token !== token) {
      console.log('[EnhancedWS] Connected with different token, disconnecting first');
      this.disconnect();
    }
    
    if (this.isConnecting) {
      console.log('[EnhancedWS] Already connecting, skipping...');
      return false;
    }
    
    // Если сервис был уничтожен, сбрасываем состояние для возможности переподключения
    if (this.isDestroyed) {
      console.log('[EnhancedWS] Service was destroyed, resetting state for reconnection');
      this.reset();
    }

    this.token = token;
    this.url = `${process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru'}/ws/main?token=${token}`;
    this.isConnecting = true;
    
    console.log('[EnhancedWS] Attempting to connect to:', this.url);

    try {
      const result = await this.createConnection();
      console.log('[EnhancedWS] Connection result:', result);
      return result;
    } catch (error) {
      console.error('[EnhancedWS] Connection failed with error:', error);
      this.handleConnectionError(error);
      return false;
    }
  }

  /**
   * 🔌 Создание WebSocket соединения
   */
  private async createConnection(): Promise<boolean> {
    console.log('[EnhancedWS] createConnection() called');
    
    return new Promise((resolve, reject) => {
      try {
        console.log('[EnhancedWS] Creating WebSocket instance for URL:', this.url);
        this.ws = new WebSocket(this.url);
        console.log('[EnhancedWS] WebSocket instance created, readyState:', this.ws.readyState);
        
        this.ws.onopen = () => {
          console.log('[EnhancedWS] WebSocket onopen triggered');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.metrics.connectionQuality = 'excellent';
          this.notifyConnectionStatus('connected');
          this.startHeartbeat();
          this.processQueuedMessages();
          console.log('[EnhancedWS] WebSocket successfully opened, resolving with true');
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          console.log('[EnhancedWS] Received message:', event.data);
          this.handleMessage(event);
        };

        this.ws.onclose = (event) => {
          console.log('[EnhancedWS] WebSocket onclose triggered', { code: event.code, reason: event.reason });
          this.handleDisconnection(event);
          resolve(false);
        };

        this.ws.onerror = (error) => {
          console.error('[EnhancedWS] WebSocket onerror triggered:', error);
          this.handleConnectionError(error);
          reject(error);
        };

        // Connection timeout
        setTimeout(() => {
          if (this.isConnecting) {
            console.warn('[EnhancedWS] Connection timeout reached');
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, 10000); // 10 second timeout

      } catch (error) {
        console.error('[EnhancedWS] Error creating WebSocket:', error);
        reject(error);
      }
    });
  }

  /**
   * 📨 Обработка входящих сообщений
   */
  private handleMessage(event: MessageEvent) {
    try {
      const startTime = performance.now();
      const data = JSON.parse(event.data);
      
      // Update metrics
      this.metrics.totalMessages++;
      this.metrics.bytesReceived += event.data.length;
      this.updateLatency(performance.now() - startTime);
      
      // Handle different message types
      if (data.type === 'batch') {
        this.handleBatchedMessages(data as BatchedMessages);
      } else if (data.type === 'ping') {
        this.handlePing();
      } else if (data.type === 'pong') {
        this.handlePong();
      } else if (data.type === 'connection_established') {
        this.handleConnectionEstablished(data);
      } else {
        this.dispatchMessage(data.type, data);
      }
      
    } catch (error) {
      console.error('[EnhancedWS] Message parsing error:', error);
    }
  }

  /**
   * 📦 Обработка батчированных сообщений
   */
  private handleBatchedMessages(batch: BatchedMessages) {
    for (const message of batch.messages) {
      this.dispatchMessage(message.type, message);
    }
  }

  /**
   * 💓 Обработка ping
   */
  private handlePing() {
    this.send({ type: 'pong', timestamp: Date.now() }, 3);
  }

  /**
   * 🏓 Обработка pong
   */
  private handlePong() {
    this.lastPongTime = Date.now();
    this.updateConnectionQuality();
  }

  /**
   * 🎉 Обработка установления соединения
   */
  private handleConnectionEstablished(data: any) {
    this.notifyConnectionStatus('established');
  }

  /**
   * 📡 Отправка сообщения
   */
  send(data: WebSocketMessage, priority: number = 2): string {
    const messageId = this.generateMessageId();
    
    const queuedMessage: QueuedMessage = {
      id: messageId,
      data,
      priority,
      timestamp: Date.now(),
      retries: 0
    };

    if (this.isConnected()) {
      this.sendDirectly(queuedMessage);
    } else {
      this.queueMessage(queuedMessage);
    }

    return messageId;
  }

  /**
   * 📤 Прямая отправка сообщения
   */
  private sendDirectly(message: QueuedMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queueMessage(message);
      return false;
    }

    try {
      const messageString = JSON.stringify(message.data);
      this.ws.send(messageString);
      this.metrics.bytesSent += messageString.length;
      return true;
    } catch (error) {
      this.queueMessage(message);
      return false;
    }
  }

  /**
   * 📥 Добавление сообщения в очередь
   */
  private queueMessage(message: QueuedMessage) {
    if (this.messageQueue.size >= this.maxQueueSize) {
      // Remove oldest low-priority message
      for (const [id, queuedMsg] of Array.from(this.messageQueue.entries())) {
        if (queuedMsg.priority === 1) {
          this.messageQueue.delete(id);
          break;
        }
      }
    }

    this.messageQueue.set(message.id, message);
  }

  /**
   * 🔄 Обработка очереди сообщений
   */
  private async processQueuedMessages() {
    if (!this.isConnected()) return;

    // Sort by priority and timestamp
    const messages = Array.from(this.messageQueue.values())
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority; // Higher priority first
        }
        return a.timestamp - b.timestamp; // Older first
      });

    for (const message of messages) {
      if (this.sendDirectly(message)) {
        this.messageQueue.delete(message.id);
      } else {
        break; // Stop processing if send fails
      }
    }
  }

  /**
   * 🔁 Автоматическое переподключение
   */
  private async handleDisconnection(event: CloseEvent) {
    this.stopHeartbeat();
    this.metrics.connectionQuality = 'disconnected';
    this.notifyConnectionStatus('disconnected');

    if (this.isDestroyed || event.code === 1000) {
      return; // Normal closure or service destroyed
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.calculateReconnectDelay();
      this.metrics.reconnectionAttempts++;
      this.metrics.lastReconnect = Date.now();
      
      this.reconnectTimeout = setTimeout(async () => {
        this.reconnectAttempts++;
        await this.createConnection();
      }, delay);
    } else {
      this.notifyConnectionStatus('failed');
    }
  }

  /**
   * 📊 Вычисление задержки переподключения
   */
  private calculateReconnectDelay(): number {
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }

  /**
   * ❌ Обработка ошибок соединения
   */
  private handleConnectionError(error: any) {
    this.isConnecting = false;
    this.metrics.connectionQuality = 'poor';
    this.notifyConnectionStatus('error');
  }

  /**
   * 💓 Запуск heartbeat
   */
  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'heartbeat', timestamp: Date.now() }, 3);
        
        // Check pong response
        if (Date.now() - this.lastPongTime > 30000) { // 30 seconds
          this.ws?.close(1000, 'Heartbeat timeout');
        }
      }
    }, 15000); // Send heartbeat every 15 seconds
  }

  /**
   * 💓 Остановка heartbeat
   */
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 📊 Обновление качества соединения
   */
  private updateConnectionQuality() {
    const latency = this.metrics.averageLatency;
    
    if (latency < 100) {
      this.metrics.connectionQuality = 'excellent';
    } else if (latency < 250) {
      this.metrics.connectionQuality = 'good';
    } else {
      this.metrics.connectionQuality = 'poor';
    }
  }

  /**
   * ⏱️ Обновление метрик латентности
   */
  private updateLatency(latency: number) {
    this.latencyMeasurements.push(latency);
    
    // Keep only last 100 measurements
    if (this.latencyMeasurements.length > 100) {
      this.latencyMeasurements.shift();
    }
    
    // Calculate average
    const sum = this.latencyMeasurements.reduce((a, b) => a + b, 0);
    this.metrics.averageLatency = sum / this.latencyMeasurements.length;
  }

  /**
   * 📊 Запуск мониторинга производительности
   */
  private startPerformanceMonitoring() {
    setInterval(() => {
      const now = Date.now();
      const timeDiff = now - this.lastMessageTime;
      
      if (timeDiff > 0) {
        this.metrics.messagesPerSecond = (this.messageCount * 1000) / timeDiff;
        this.messageCount = 0;
        this.lastMessageTime = now;
      }
    }, 1000);
  }

  /**
   * 🔀 Диспетчеризация сообщений
   */
  private dispatchMessage(type: string, data: any) {
    const handlers = this.messageHandlers.get(type) || [];
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`[EnhancedWS] Handler error for ${type}:`, error);
      }
    });
    
    this.messageCount++;
  }

  /**
   * 🔔 Уведомление о статусе соединения
   */
  private notifyConnectionStatus(status: string) {
    this.connectionStatusHandlers.forEach(handler => {
      try {
        handler(status);
      } catch (error) {
        console.error('[EnhancedWS] Connection status handler error:', error);
      }
    });
  }

  /**
   * 🆔 Генерация уникального ID сообщения
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public API methods

  /**
   * ✅ Проверка состояния соединения
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 📈 Получение метрик производительности
   */
  getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }

  /**
   * 📝 Подписка на сообщения определенного типа
   */
  onMessage(type: string, handler: (data: any) => void): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    
    this.messageHandlers.get(type)!.push(handler);
    
    // Return unsubscribe function
    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * 🔗 Подписка на изменения статуса соединения
   */
  onConnectionStatusChange(handler: (status: string) => void): () => void {
    this.connectionStatusHandlers.push(handler);
    
    return () => {
      const index = this.connectionStatusHandlers.indexOf(handler);
      if (index > -1) {
        this.connectionStatusHandlers.splice(index, 1);
      }
    };
  }

  // Chat-specific methods

  /**
   * 💬 Отправка сообщения в чат
   */
  sendChatMessage(channelId: number, content: string, attachments: string[] = [], replyToId?: number): string {
    return this.send({
      type: 'chat_message',
      channel_id: channelId,
      content,
      attachments,
      reply_to_id: replyToId
    }, 2);
  }

  /**
   * ⌨️ Отправка статуса печати
   */
  sendTyping(channelId: number): string {
    return this.send({
      type: 'typing',
      channel_id: channelId
    }, 1);
  }

  /**
   * 🚪 Присоединение к каналу
   */
  joinChannel(channelId: number): string {
    return this.send({
      type: 'join_channel',
      channel_id: channelId
    }, 2);
  }

  /**
   * 🚪 Покидание канала
   */
  leaveChannel(channelId: number): string {
    return this.send({
      type: 'leave_channel',
      channel_id: channelId
    }, 2);
  }

  /**
   * 😀 Добавление реакции
   */
  addReaction(messageId: number, emoji: string, channelId: number): string {
    return this.send({
      type: 'reaction_add',
      message_id: messageId,
      emoji,
      channel_id: channelId
    }, 1);
  }

  /**
   * ❌ Удаление реакции
   */
  removeReaction(messageId: number, emoji: string, channelId: number): string {
    return this.send({
      type: 'reaction_remove',
      message_id: messageId,
      emoji,
      channel_id: channelId
    }, 1);
  }

  /**
   * 🛑 Отключение WebSocket (с возможностью переподключения)
   */
  disconnect() {
    console.log('[EnhancedWS] disconnect() called');
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    this.stopHeartbeat();
    
    if (this.ws) {
      console.log('[EnhancedWS] Closing WebSocket connection');
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
    
    this.metrics.connectionQuality = 'disconnected';
    this.notifyConnectionStatus('disconnected');
    
    console.log('[EnhancedWS] WebSocket disconnected');
  }

  /**
   * 💀 Полное уничтожение сервиса (без возможности переподключения)
   */
  destroy() {
    console.log('[EnhancedWS] destroy() called - permanent shutdown');
    
    this.isDestroyed = true;
    this.disconnect();
    
    // Очищаем все обработчики и очереди
    this.messageQueue.clear();
    this.messageHandlers.clear();
    this.connectionStatusHandlers.length = 0;
    
    console.log('[EnhancedWS] Service permanently destroyed');
  }

  /**
   * 🔄 Сброс состояния сервиса для возможности переподключения
   */
  private reset() {
    console.log('[EnhancedWS] Resetting service state');
    this.isDestroyed = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    
    // Очищаем таймеры
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    // Сбрасываем метрики
    this.metrics.connectionQuality = 'disconnected';
    this.metrics.reconnectionAttempts = 0;
    
    console.log('[EnhancedWS] Service state reset complete');
  }
}

// Create singleton instance
const enhancedWebSocketService = new EnhancedWebSocketService();

export default enhancedWebSocketService; 