import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Server, Channel, Message, User, FullServerData } from '../types';
import channelService from '../services/channelService';
import websocketService from '../services/websocketService';
import uploadService from '../services/uploadService';
import chatService from '../services/chatService';

interface AppState {
  // Данные
  servers: Server[];
  currentServer: Server | null;
  currentChannel: Channel | null;
  messages: { [channelId: number]: Message[] };
  user: User | null;
  isLoading: boolean;
  error: string | null;
  typingStatus: { [channelId: number]: { username: string; timeoutId: NodeJS.Timeout }[] };
  currentServerMembers: User[];

  // Действия для серверов
  selectServer: (serverId: number) => Promise<void>;
  selectChannel: (channelId: number) => void;
  addServer: (server: Server) => void;
  updateServer: (serverId: number, updates: Partial<Server>) => void;
  removeServer: (serverId: number) => void;

  // Действия для каналов
  addChannel: (serverId: number, channel: Channel) => void;

  // Сообщения
  sendMessage: (content: string, files: File[]) => Promise<void>;
  addMessage: (message: Message) => void;
  sendTyping: () => void;
  setTyping: (channelId: number, username: string) => void;
  clearTyping: (channelId: number, username: string) => void;

  // Пользователь
  setUser: (user: User | null) => void;
  logout: () => void;

  // Загрузка данных
  loadServers: () => Promise<void>;
  loadServerDetails: (serverId: number) => Promise<void>;

  // Состояние
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // WebSocket
  initializeWebSocket: (token: string) => void;
  disconnectWebSocket: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Начальное состояние
      servers: [],
      currentServer: null,
      currentChannel: null,
      messages: {},
      user: null,
      isLoading: false,
      error: null,
      typingStatus: {},
      currentServerMembers: [],

      // Выбор сервера
      selectServer: async (serverId: number) => {
        const { servers, loadServerDetails } = get();
        const server = servers.find(s => s.id === serverId);
        
        if (server) {
          set({ currentServer: server, currentChannel: null });
          await loadServerDetails(serverId);
        }
      },

      // Выбор канала
      selectChannel: (channelId: number) => {
        const { currentServer, user } = get();
        if (currentServer) {
          const channel = currentServer.channels.find(c => c.id === channelId);
          if (channel) {
            set({ currentChannel: channel });
            // Подключаемся к WebSocket чата
            if (channel.type === 'text' && user) {
              chatService.disconnect();
              chatService.connect(channel.id, localStorage.getItem('access_token') || '');
              chatService.onMessage((msg) => {
                get().addMessage(msg);
              });
              chatService.onTyping((data) => {
                if (data.user && data.text_channel_id) {
                  get().setTyping(data.text_channel_id, data.user.username);
                }
              });
            } else {
              chatService.disconnect();
            }
          }
        }
      },

      // Добавление сервера
      addServer: (server: Server) => {
        set((state) => {
          // Проверяем, существует ли уже сервер с таким ID
          const existingServer = state.servers.find(s => s.id === server.id);
          if (existingServer) {
            // Если сервер уже существует, не добавляем его снова
            return state;
          }
          return {
            servers: [...state.servers, server]
          };
        });
      },

      // Обновление сервера
      updateServer: (serverId: number, updates: Partial<Server>) => {
        set((state) => ({
          servers: state.servers.map(server =>
            server.id === serverId ? { ...server, ...updates } : server
          ),
          currentServer: state.currentServer?.id === serverId 
            ? { ...state.currentServer, ...updates }
            : state.currentServer
        }));
      },

      // Удаление сервера
      removeServer: (serverId: number) => {
        set((state) => {
          const filteredServers = state.servers.filter(server => server.id !== serverId);
          
          // Если удаляется текущий сервер, сбрасываем выбор
          const isCurrentServer = state.currentServer?.id === serverId;
          const newCurrentServer = isCurrentServer ? null : state.currentServer;
          const newCurrentChannel = isCurrentServer ? null : state.currentChannel;
          
          return {
            servers: filteredServers,
            currentServer: newCurrentServer,
            currentChannel: newCurrentChannel,
            currentServerMembers: newCurrentServer ? state.currentServerMembers : []
          };
        });
      },

      // Добавление канала
      addChannel: (serverId: number, channel: Channel) => {
        set((state) => {
          const updatedServers = state.servers.map(server => {
            if (server.id === serverId) {
              // Проверяем, существует ли уже канал с таким ID
              const existingChannel = server.channels.find(c => c.id === channel.id);
              if (existingChannel) {
                // Если канал уже существует, возвращаем сервер без изменений
                return server;
              }
              return { ...server, channels: [...server.channels, channel] };
            }
            return server;
          });

          const updatedCurrentServer = state.currentServer?.id === serverId
            ? updatedServers.find(s => s.id === serverId) || state.currentServer
            : state.currentServer;

          return {
            servers: updatedServers,
            currentServer: updatedCurrentServer
          };
        });
      },

      // Отправка сообщения
      sendMessage: async (content: string, files: File[]) => {
        const { currentChannel, user } = get();
        if (!currentChannel || !user || currentChannel.type !== 'text') {
          return;
        }
        if (!content.trim() && files.length === 0) {
          return;
        }
        if (content.length > 5000) {
          get().setError("Сообщение не может быть длиннее 5000 символов.");
          return;
        }
        if (files.length > 3) {
          get().setError("Можно прикрепить не более 3 изображений.");
          return;
        }

        set({ isLoading: true });
        try {
          const attachmentUrls: string[] = [];
          for (const file of files) {
            const response = await uploadService.uploadFile(file);
            attachmentUrls.push(response.file_url);
          }
          chatService.sendMessage(content, attachmentUrls);
        } catch (error) {
          get().setError("Не удалось отправить сообщение.");
        } finally {
          set({ isLoading: false });
        }
      },

      // Добавление сообщения
      addMessage: (message: Message) => {
        set((state) => ({
          messages: {
            ...state.messages,
            [message.channelId]: [...(state.messages[message.channelId] || []), message],
          },
        }));
      },

      // Отправка статуса печати
      sendTyping: () => {
        const { currentChannel } = get();
        if (currentChannel?.type === 'text') {
          chatService.sendTyping();
        }
      },
      
      // Установка статуса печати
      setTyping: (channelId, username) => {
        const { typingStatus, clearTyping } = get();
        
        const timeoutId = setTimeout(() => {
          clearTyping(channelId, username);
        }, 2000); // 2 секунды

        const existingUser = (typingStatus[channelId] || []).find(u => u.username === username);
        if (existingUser) {
          clearTimeout(existingUser.timeoutId);
        }

        const newTypingUsers = [
          ...(typingStatus[channelId] || []).filter(u => u.username !== username),
          { username, timeoutId }
        ];

        set({
          typingStatus: {
            ...typingStatus,
            [channelId]: newTypingUsers
          }
        });
      },

      clearTyping: (channelId, username) => {
        set(state => {
          const newTypingUsers = (state.typingStatus[channelId] || []).filter(u => u.username !== username);
          return {
            typingStatus: {
              ...state.typingStatus,
              [channelId]: newTypingUsers
            }
          }
        });
      },

      // Установка пользователя
      setUser: (user: User | null) => {
        set({ user });
      },

      // Выход
      logout: () => {
        get().disconnectWebSocket();
        set({ 
          user: null, 
          currentServer: null, 
          currentChannel: null, 
          messages: {},
          servers: []
        });
      },

      // Загрузка серверов
      loadServers: async () => {
        set({ isLoading: true, error: null });
        try {
          const fullData: FullServerData = await channelService.getFullServerData();
          const servers: Server[] = fullData.servers.map((s: any) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            icon: s.icon,
            owner_id: s.owner_id,
            channels: [
              ...(s.text_channels || []).map((c: any) => ({
                id: c.id,
                name: c.name,
                type: 'text' as const,
                serverId: s.id,
              })),
              ...(s.voice_channels || []).map((c: any) => ({
                id: c.id,
                name: c.name,
                type: 'voice' as const,
                serverId: s.id,
              })),
            ]
          }));
          set({ servers, isLoading: false });
          const { currentServer } = get();
          if (currentServer) {
            const updatedCurrentServer = servers.find(s => s.id === currentServer.id);
            if (updatedCurrentServer) {
              set({ currentServer: updatedCurrentServer });
              // Автоматически загружаем детали текущего сервера (включая участников)
              await get().loadServerDetails(currentServer.id);
            } else {
              set({ currentServer: null, currentChannel: null });
            }
          } else if (servers.length > 0) {
            // Если нет текущего сервера, но есть серверы - выбираем первый
            const firstServer = servers[0];
            set({ currentServer: firstServer });
            await get().loadServerDetails(firstServer.id);
          }
        } catch (error: any) {
          set({ 
            error: error.response?.data?.detail || 'Ошибка загрузки серверов', 
            isLoading: false 
          });
        }
      },

      // Загрузка деталей сервера
      loadServerDetails: async (serverId: number) => {
        try {
          const serverDetails = await channelService.getChannelDetails(serverId)
          
          const channels: Channel[] = (serverDetails.channels || []).map((ch: any) => ({
            id: ch.id,
            name: ch.name,
            type: ch.type,
            serverId: serverId
          }))
          
          const updatedServer: Server = {
            id: serverDetails.id,
            name: serverDetails.name,
            description: serverDetails.description,
            icon: serverDetails.icon,
            channels
          }
          
          set((state) => ({
            servers: state.servers.map(server =>
              server.id === serverId ? updatedServer : server
            ),
            currentServer: updatedServer,
            currentServerMembers: serverDetails.members || []
          }))
        } catch (error) {
          // Ошибка загрузки деталей сервера
        }
      },

      // Установка загрузки
      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },

      // Установка ошибки
      setError: (error: string | null) => {
        set({ error });
      },

      // Инициализация WebSocket
      initializeWebSocket: (token: string) => {
        websocketService.connect(token);
        
        // Обработка приглашения в канал
        websocketService.onChannelInvitation((data) => {
          // Перезагружаем список серверов
          get().loadServers();
        });
        
        // Обработка создания нового сервера
        websocketService.onServerCreated((data) => {
          // Добавляем новый сервер в список
          const newServer: Server = {
            id: data.server.id,
            name: data.server.name,
            description: data.server.description,
            icon: data.server.icon,
            owner_id: data.server.owner_id,
            channels: []
          };
          get().addServer(newServer);
        });

        // Обработка обновления сервера
        websocketService.onServerUpdated((data) => {
          get().updateServer(data.server_id, {
            name: data.name,
            description: data.description,
            icon: data.icon
          });
        });

        // Обработка удаления сервера
        websocketService.onServerDeleted((data) => {
          // WebSocket событие имеет структуру: { type: 'server_deleted', data: { server_id, server_name, deleted_by } }
          const eventData = (data as any).data || data;
          const serverId = eventData.server_id;
          
          if (serverId) {
            get().removeServer(serverId);
          }
        });
        
        // Обработка создания текстового канала
        websocketService.onTextChannelCreated((data) => {
          // Добавляем новый канал в соответствующий сервер
          const newChannel: Channel = {
            id: data.text_channel.id,
            name: data.text_channel.name,
            type: 'text',
            serverId: data.channel_id
          };
          get().addChannel(data.channel_id, newChannel);
        });
        
        // Обработка создания голосового канала
        websocketService.onVoiceChannelCreated((data) => {
          // Добавляем новый канал в соответствующий сервер
          const newChannel: Channel = {
            id: data.voice_channel.id,
            name: data.voice_channel.name,
            type: 'voice',
            serverId: data.channel_id
          };
          get().addChannel(data.channel_id, newChannel);
        });
        
        // Обработка присоединения пользователя
        websocketService.onUserJoinedChannel((data) => {
          const { currentServer } = get();
          if (currentServer?.id === data.channel_id) {
            get().loadServerDetails(data.channel_id);
          }
        });
        
        // Обработка выхода пользователя
        websocketService.onUserLeftChannel((data) => {
          const { currentServer } = get();
          if (currentServer?.id === data.channel_id) {
            get().loadServerDetails(data.channel_id);
          }
        });
        
        // Обработка обновления канала
        websocketService.onChannelUpdated((data) => {
          const { currentServer } = get();
          if (currentServer?.id === data.channel_id) {
            get().loadServerDetails(data.channel_id);
          }
        });
        
        // Обработка присоединения к голосовому каналу
        websocketService.onVoiceChannelJoin((data) => {
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('voice_channel_join', { detail: data }));
        });
        
        // Обработка выхода из голосового канала
        websocketService.onVoiceChannelLeave((data) => {
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('voice_channel_leave', { detail: data }));
        });

        // Обработка начала демонстрации экрана
        websocketService.onScreenShareStarted((data) => {
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('screen_share_start', { detail: data }));
        });

        // Обработка остановки демонстрации экрана
        websocketService.onScreenShareStopped((data) => {
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('screen_share_stop', { detail: data }));
        });

        // Обработка изменения статуса пользователя
        websocketService.onUserStatusChanged((data) => {
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('user_status_changed', { detail: data }));
        });
      },

      // Отключение WebSocket
      disconnectWebSocket: () => {
        websocketService.disconnect();
      }
    }),
    {
      name: 'miscord-store',
      partialize: (state) => ({
        servers: state.servers,
        currentServer: state.currentServer,
        currentChannel: state.currentChannel,
        user: state.user
      })
    }
  )
);

// Автоматическое подключение к чату при инициализации store (например, после обновления страницы)
if (typeof window !== 'undefined') {
  const { currentChannel, user } = useStore.getState();
  if (currentChannel && currentChannel.type === 'text' && user) {
    chatService.disconnect();
    chatService.connect(currentChannel.id, localStorage.getItem('access_token') || '');
    chatService.onMessage((msg) => {
      useStore.getState().addMessage(msg);
    });
    chatService.onTyping((data) => {
      if (data.user && data.text_channel_id) {
        useStore.getState().setTyping(data.text_channel_id, data.user.username);
      }
    });
  }
} 