/**
 * Оптимизированное хранилище состояния приложения
 * Использует единый унифицированный WebSocket сервис
 * Минимизирует перерендеры через селекторы
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { Server, Channel, Message, User, FullServerData } from '../types';
import channelService from '../services/channelService';
import unifiedWebSocketService from '../services/unifiedWebSocketService';
import uploadService from '../services/uploadService';

// ==================== ТИПЫ ====================

interface AppState {
  // Данные
  servers: Server[];
  currentServerId: number | null;
  currentChannelId: number | null;
  messages: Map<number, Message[]>;
  user: User | null;
  isLoading: boolean;
  error: string | null;
  typingStatus: Map<number, Map<string, NodeJS.Timeout>>;
  serverMembers: Map<number, User[]>;
  
  // WebSocket статус
  wsStatus: {
    isConnected: boolean;
    isReconnecting: boolean;
    reconnectAttempts: number;
    lastError?: string;
  };

  // Действия для серверов
  selectServer: (serverId: number) => Promise<void>;
  selectChannel: (channelId: number) => void;
  addServer: (server: Server) => void;
  updateServer: (serverId: number, updates: Partial<Server>) => void;
  removeServer: (serverId: number) => void;

  // Действия для каналов
  addChannel: (serverId: number, channel: Channel) => void;

  // Сообщения
  sendMessage: (content: string, files: File[], replyToId?: number) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: number, updates: Partial<Message>) => void;
  deleteMessage: (messageId: number, channelId: number) => void;
  sendTyping: () => void;
  setTyping: (channelId: number, username: string) => void;
  clearTyping: (channelId: number, username: string) => void;

  // Пользователь
  setUser: (user: User | null) => void;
  logout: () => void;

  // Загрузка данных
  loadServers: () => Promise<void>;
  loadServerDetails: (serverId: number) => Promise<void>;
  loadChannelMessages: (channelId: number) => Promise<void>;

  // WebSocket
  initializeWebSocket: (token: string) => void;
  disconnectWebSocket: () => void;
  setWsStatus: (status: Partial<AppState['wsStatus']>) => void;

  // Утилиты
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

// Селекторы для оптимизации
export const selectCurrentServer = (state: AppState) => 
  state.servers.find(s => s.id === state.currentServerId) || null;

export const selectCurrentChannel = (state: AppState) => {
  const server = selectCurrentServer(state);
  return server?.channels.find(c => c.id === state.currentChannelId) || null;
};

export const selectCurrentMessages = (state: AppState) => 
  state.currentChannelId ? state.messages.get(state.currentChannelId) || [] : [];

export const selectServerMembers = (state: AppState) => 
  state.currentServerId ? state.serverMembers.get(state.currentServerId) || [] : [];

export const selectTypingUsers = (state: AppState) => 
  state.currentChannelId ? Array.from(state.typingStatus.get(state.currentChannelId)?.keys() || []) : [];

// ==================== STORE ====================

export const useOptimizedStore = create<AppState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // Начальное состояние
        servers: [],
        currentServerId: null,
        currentChannelId: null,
        messages: new Map(),
        user: null,
        isLoading: false,
        error: null,
        typingStatus: new Map(),
        serverMembers: new Map(),
        wsStatus: {
          isConnected: false,
          isReconnecting: false,
          reconnectAttempts: 0
        },

        // ==================== СЕРВЕРЫ ====================

        selectServer: async (serverId: number) => {
          const { servers, loadServerDetails } = get();
          
          if (serverId === 0) {
            set({ currentServerId: null, currentChannelId: null });
            return;
          }
          
          const server = servers.find(s => s.id === serverId);
          
          if (server) {
            set({ currentServerId: serverId, currentChannelId: null });
            await loadServerDetails(serverId);
          }
        },

        selectChannel: (channelId: number) => {
          const { currentServerId, servers, loadChannelMessages } = get();
          
          if (!currentServerId) return;
          
          const server = servers.find(s => s.id === currentServerId);
          if (!server) return;
          
          const channel = server.channels.find(c => c.id === channelId);
          if (!channel) return;

          set({ currentChannelId: channelId });
          
          // Загружаем сообщения если это текстовый канал
          if (channel.type === 'text') {
            loadChannelMessages(channelId);
          }
        },

        addServer: (server: Server) => {
          set((state) => {
            if (state.servers.find(s => s.id === server.id)) {
              return state;
            }
            return {
              servers: [...state.servers, server]
            };
          });
        },

        updateServer: (serverId: number, updates: Partial<Server>) => {
          set((state) => {
            const servers = state.servers.map(server =>
              server.id === serverId ? { ...server, ...updates } : server
            );
            return { servers };
          });
        },

        removeServer: (serverId: number) => {
          set((state) => {
            const servers = state.servers.filter(s => s.id !== serverId);
            const currentServerId = state.currentServerId === serverId ? null : state.currentServerId;
            const currentChannelId = state.currentServerId === serverId ? null : state.currentChannelId;
            
            return { servers, currentServerId, currentChannelId };
          });
        },

        // ==================== КАНАЛЫ ====================

        addChannel: (serverId: number, channel: Channel) => {
          set((state) => {
            const servers = state.servers.map(server => {
              if (server.id === serverId) {
                const existingChannel = server.channels.find(c => c.id === channel.id);
                if (existingChannel) return server;
                
                return {
                  ...server,
                  channels: [...server.channels, channel]
                };
              }
              return server;
            });
            return { servers };
          });
        },

        // ==================== СООБЩЕНИЯ ====================

        sendMessage: async (content: string, files: File[], replyToId?: number) => {
          const { currentChannelId } = get();
          
          if (!currentChannelId) {
            console.error('[Store] Нет текущего канала');
            return;
          }

          try {
            // Загружаем файлы если есть
            const attachments: string[] = [];
            for (const file of files) {
              try {
                const result = await uploadService.uploadFile(file);
                // uploadService возвращает объект с file_url
                const url = typeof result === 'string' ? result : result.file_url;
                attachments.push(url);
              } catch (error) {
                console.error('[Store] Ошибка загрузки файла:', error);
              }
            }

            // Отправляем через унифицированный WebSocket
            unifiedWebSocketService.sendChatMessage(
              currentChannelId,
              content,
              attachments,
              replyToId
            );
          } catch (error) {
            console.error('[Store] Ошибка отправки сообщения:', error);
            set({ error: 'Не удалось отправить сообщение' });
          }
        },

        addMessage: (message: Message) => {
          set((state) => {
            const channelId = message.channelId;
            const channelMessages = state.messages.get(channelId) || [];
            
            // Проверяем дубликаты
            if (channelMessages.find(m => m.id === message.id)) {
              return state;
            }

            const newMessages = new Map(state.messages);
            newMessages.set(channelId, [...channelMessages, message]);
            
            return { messages: newMessages };
          });
        },

        updateMessage: (messageId: number, updates: Partial<Message>) => {
          set((state) => {
            const newMessages = new Map(state.messages);
            
            for (const [channelId, messages] of newMessages.entries()) {
              const messageIndex = messages.findIndex(m => m.id === messageId);
              if (messageIndex !== -1) {
                const updatedMessages = [...messages];
                updatedMessages[messageIndex] = { ...messages[messageIndex], ...updates };
                newMessages.set(channelId, updatedMessages);
                break;
              }
            }
            
            return { messages: newMessages };
          });
        },

        deleteMessage: (messageId: number, channelId: number) => {
          set((state) => {
            const newMessages = new Map(state.messages);
            const channelMessages = newMessages.get(channelId) || [];
            
            newMessages.set(
              channelId,
              channelMessages.filter(m => m.id !== messageId)
            );
            
            return { messages: newMessages };
          });
        },

        sendTyping: () => {
          const { currentChannelId } = get();
          if (currentChannelId) {
            unifiedWebSocketService.sendTyping(currentChannelId);
          }
        },

        setTyping: (channelId: number, username: string) => {
          set((state) => {
            const newTypingStatus = new Map(state.typingStatus);
            
            if (!newTypingStatus.has(channelId)) {
              newTypingStatus.set(channelId, new Map());
            }
            
            const channelTyping = newTypingStatus.get(channelId)!;
            
            // Очищаем предыдущий таймаут если есть
            const existingTimeout = channelTyping.get(username);
            if (existingTimeout) {
              clearTimeout(existingTimeout);
            }
            
            // Устанавливаем новый таймаут
            const timeout = setTimeout(() => {
              get().clearTyping(channelId, username);
            }, 3000);
            
            channelTyping.set(username, timeout);
            
            return { typingStatus: newTypingStatus };
          });
        },

        clearTyping: (channelId: number, username: string) => {
          set((state) => {
            const newTypingStatus = new Map(state.typingStatus);
            const channelTyping = newTypingStatus.get(channelId);
            
            if (channelTyping) {
              const timeout = channelTyping.get(username);
              if (timeout) {
                clearTimeout(timeout);
              }
              channelTyping.delete(username);
              
              if (channelTyping.size === 0) {
                newTypingStatus.delete(channelId);
              }
            }
            
            return { typingStatus: newTypingStatus };
          });
        },

        // ==================== ПОЛЬЗОВАТЕЛЬ ====================

        setUser: (user: User | null) => {
          set({ user });
        },

        logout: () => {
          get().disconnectWebSocket();
          set({
            servers: [],
            currentServerId: null,
            currentChannelId: null,
            messages: new Map(),
            user: null,
            serverMembers: new Map(),
            typingStatus: new Map()
          });
        },

        // ==================== ЗАГРУЗКА ДАННЫХ ====================

        loadServers: async () => {
          set({ isLoading: true, error: null });
          
          try {
            const servers = await channelService.getServers();
            set({ servers, isLoading: false });
          } catch (error: any) {
            console.error('[Store] Ошибка загрузки серверов:', error);
            set({ 
              error: error.message || 'Не удалось загрузить серверы',
              isLoading: false
            });
          }
        },

        loadServerDetails: async (serverId: number) => {
          try {
            const serverData: FullServerData = await channelService.getServerDetails(serverId);
            
            set((state) => {
              const servers = state.servers.map(server => {
                if (server.id === serverId) {
                  return {
                    ...server,
                    channels: serverData.channels,
                    members: serverData.members
                  };
                }
                return server;
              });

              const newServerMembers = new Map(state.serverMembers);
              newServerMembers.set(serverId, serverData.members);

              return { servers, serverMembers: newServerMembers };
            });
          } catch (error: any) {
            console.error('[Store] Ошибка загрузки деталей сервера:', error);
            set({ error: error.message || 'Не удалось загрузить детали сервера' });
          }
        },

        loadChannelMessages: async (channelId: number) => {
          try {
            const existingMessages = get().messages.get(channelId);
            
            // Если сообщения уже загружены, не загружаем повторно
            if (existingMessages && existingMessages.length > 0) {
              return;
            }

            const messages = await channelService.getMessages(channelId);
            
            set((state) => {
              const newMessages = new Map(state.messages);
              newMessages.set(channelId, messages);
              return { messages: newMessages };
            });
          } catch (error: any) {
            console.error('[Store] Ошибка загрузки сообщений:', error);
            set({ error: error.message || 'Не удалось загрузить сообщения' });
          }
        },

        // ==================== WEBSOCKET ====================

        initializeWebSocket: (token: string) => {
          const { addMessage, setTyping, updateMessage, deleteMessage } = get();

          // Подключаемся
          unifiedWebSocketService.connect(token);

          // Подписываемся на статус соединения
          unifiedWebSocketService.onConnectionStatusChange((status) => {
            set({ wsStatus: status });
          });

          // Обработчики сообщений
          unifiedWebSocketService.onNewMessage((message) => {
            console.log('[Store] Новое сообщение:', message);
            addMessage(message);
          });

          unifiedWebSocketService.onTyping((data) => {
            if (data.user.username !== get().user?.username) {
              setTyping(data.text_channel_id, data.user.username);
            }
          });

          unifiedWebSocketService.onMessageEdited((message) => {
            updateMessage(message.id, message);
          });

          unifiedWebSocketService.onMessageDeleted((data) => {
            deleteMessage(data.message_id, data.text_channel_id);
          });

          // Обработчики серверов и каналов
          unifiedWebSocketService.onServerCreated((data) => {
            get().addServer(data.server);
          });

          unifiedWebSocketService.onServerUpdated((data) => {
            get().updateServer(data.server_id, {
              name: data.name,
              description: data.description,
              icon: data.icon
            });
          });

          unifiedWebSocketService.onServerDeleted((data) => {
            get().removeServer(data.server_id);
          });

          unifiedWebSocketService.onTextChannelCreated((data) => {
            get().addChannel(data.channel_id, data.text_channel);
          });

          unifiedWebSocketService.onVoiceChannelCreated((data) => {
            get().addChannel(data.channel_id, data.voice_channel);
          });

          console.log('[Store] ✅ Унифицированный WebSocket инициализирован');
        },

        disconnectWebSocket: () => {
          unifiedWebSocketService.disconnect();
          set({
            wsStatus: {
              isConnected: false,
              isReconnecting: false,
              reconnectAttempts: 0
            }
          });
        },

        setWsStatus: (status) => {
          set((state) => ({
            wsStatus: { ...state.wsStatus, ...status }
          }));
        },

        // ==================== УТИЛИТЫ ====================

        setLoading: (loading: boolean) => {
          set({ isLoading: loading });
        },

        setError: (error: string | null) => {
          set({ error });
        },

        clearError: () => {
          set({ error: null });
        }
      }),
      {
        name: 'miscord-app-storage',
        partialize: (state) => ({
          // Сохраняем только необходимое
          servers: state.servers,
          currentServerId: state.currentServerId,
          currentChannelId: state.currentChannelId,
          user: state.user
        })
      }
    )
  )
);

// Хуки для селекторов (предотвращают лишние рендеры)
export const useCurrentServer = () => useOptimizedStore(selectCurrentServer, shallow);
export const useCurrentChannel = () => useOptimizedStore(selectCurrentChannel, shallow);
export const useCurrentMessages = () => useOptimizedStore(selectCurrentMessages, shallow);
export const useServerMembers = () => useOptimizedStore(selectServerMembers, shallow);
export const useTypingUsers = () => useOptimizedStore(selectTypingUsers, shallow);
export const useWsStatus = () => useOptimizedStore((state) => state.wsStatus, shallow);

export default useOptimizedStore;

