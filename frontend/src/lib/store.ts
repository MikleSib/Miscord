import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Server, Channel, Message, User } from '../types';
import channelService from '../services/channelService';
import websocketService from '../services/websocketService';

interface AppState {
  // Данные
  servers: Server[];
  currentServer: Server | null;
  currentChannel: Channel | null;
  messages: { [channelId: number]: Message[] };
  user: User | null;
  isLoading: boolean;
  error: string | null;

  // Действия для серверов
  selectServer: (serverId: number) => Promise<void>;
  selectChannel: (channelId: number) => void;
  addServer: (server: Server) => void;
  updateServer: (serverId: number, updates: Partial<Server>) => void;

  // Действия для каналов
  addChannel: (serverId: number, channel: Channel) => void;

  // Сообщения
  sendMessage: (content: string) => void;
  addMessage: (channelId: number, message: Message) => void;

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
        console.log('[Store] selectChannel вызван с ID:', channelId);
        const { currentServer } = get();
        console.log('[Store] currentServer:', currentServer);
        if (currentServer) {
          const channel = currentServer.channels.find(c => c.id === channelId);
          console.log('[Store] Найден канал:', channel);
          if (channel) {
            console.log('[Store] Устанавливаем currentChannel:', channel);
            set({ currentChannel: channel });
          } else {
            console.log('[Store] Канал не найден в текущем сервере');
          }
        } else {
          console.log('[Store] Нет текущего сервера');
        }
      },

      // Добавление сервера
      addServer: (server: Server) => {
        set((state) => ({
          servers: [...state.servers, server]
        }));
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

      // Добавление канала
      addChannel: (serverId: number, channel: Channel) => {
        set((state) => ({
          servers: state.servers.map(server =>
            server.id === serverId
              ? { ...server, channels: [...server.channels, channel] }
              : server
          ),
          currentServer: state.currentServer?.id === serverId
            ? { ...state.currentServer, channels: [...state.currentServer.channels, channel] }
            : state.currentServer
        }));
      },

      // Отправка сообщения
      sendMessage: (content: string) => {
        const { currentChannel, user } = get();
        if (currentChannel && user) {
          const message: Message = {
            id: Date.now(),
            content,
            author: user,
            timestamp: new Date().toISOString(),
            channelId: currentChannel.id,
          };
          get().addMessage(currentChannel.id, message);
        }
      },

      // Добавление сообщения
      addMessage: (channelId: number, message: Message) => {
        set((state) => ({
          messages: {
            ...state.messages,
            [channelId]: [...(state.messages[channelId] || []), message],
          },
        }));
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
          const channels = await channelService.getChannels();
          
          const servers: Server[] = channels.map((channel: any) => ({
            id: channel.id,
            name: channel.name,
            description: channel.description,
            channels: []
          }));
          
          set({ servers, isLoading: false });
        } catch (error: any) {
          console.error('Ошибка загрузки серверов:', error);
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
            channels
          }
          
          set((state) => ({
            servers: state.servers.map(server =>
              server.id === serverId ? updatedServer : server
            ),
            currentServer: updatedServer
          }))
        } catch (error) {
          console.error('Ошибка загрузки деталей сервера:', error)
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
          console.log('Получено приглашение в канал:', data);
          
          // Перезагружаем список серверов
          get().loadServers();
        });
        
        // Обработка присоединения пользователя
        websocketService.onUserJoinedChannel((data) => {
          console.log('Пользователь присоединился к каналу:', data);
          
          const { currentServer } = get();
          if (currentServer?.id === data.channel_id) {
            get().loadServerDetails(data.channel_id);
          }
        });
        
        // Обработка выхода пользователя
        websocketService.onUserLeftChannel((data) => {
          console.log('Пользователь покинул канал:', data);
          
          const { currentServer } = get();
          if (currentServer?.id === data.channel_id) {
            get().loadServerDetails(data.channel_id);
          }
        });
        
        // Обработка обновления канала
        websocketService.onChannelUpdated((data) => {
          console.log('Канал обновлен:', data);
          
          const { currentServer } = get();
          if (currentServer?.id === data.channel_id) {
            get().loadServerDetails(data.channel_id);
          }
        });
        
        // Обработка присоединения к голосовому каналу
        websocketService.onVoiceChannelJoin((data) => {
          console.log('Пользователь присоединился к голосовому каналу:', data);
          
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('voice_channel_join', { detail: data }));
        });
        
        // Обработка выхода из голосового канала
        websocketService.onVoiceChannelLeave((data) => {
          console.log('Пользователь покинул голосовой канал:', data);
          
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('voice_channel_leave', { detail: data }));
        });

        // Обработка начала демонстрации экрана
        websocketService.onScreenShareStarted((data) => {
          console.log('Пользователь начал демонстрацию экрана:', data);
          
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('screen_share_start', { detail: data }));
        });

        // Обработка остановки демонстрации экрана
        websocketService.onScreenShareStopped((data) => {
          console.log('Пользователь остановил демонстрацию экрана:', data);
          
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('screen_share_stop', { detail: data }));
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