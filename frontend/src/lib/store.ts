import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Server, Channel, Message, User } from '../types';
import channelService from '../services/channelService';
import websocketService from '../services/websocketService';
import uploadService from '../services/uploadService';

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

  // Действия для серверов
  selectServer: (serverId: number) => Promise<void>;
  selectChannel: (channelId: number) => void;
  addServer: (server: Server) => void;
  updateServer: (serverId: number, updates: Partial<Server>) => void;

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
        const { currentServer } = get();
        if (currentServer) {
          const channel = currentServer.channels.find(c => c.id === channelId);
          if (channel) {
            set({ currentChannel: channel });
          }
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
      sendMessage: async (content: string, files: File[]) => {
        const { currentChannel, user } = get();
        if (!currentChannel || !user || currentChannel.type !== 'text') return;
        if (!content.trim() && files.length === 0) return;
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
          const attachmentUrls = [];
          for (const file of files) {
            const response = await uploadService.uploadFile(file);
            attachmentUrls.push(response.file_url);
          }
          
          websocketService.sendMessage(currentChannel.id, content, attachmentUrls);
          
        } catch (error) {
          console.error("Ошибка отправки сообщения:", error);
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
          websocketService.sendTyping(currentChannel.id);
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
          const backendChannels = await channelService.getChannels();
          
          const servers: Server[] = backendChannels.map((s: any) => ({
            id: s.id,
            name: s.name,
            description: s.description,
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

          // Если был выбран сервер, обновляем его данные, чтобы он не "моргнул"
          const { currentServer } = get();
          if (currentServer) {
            const updatedCurrentServer = servers.find(s => s.id === currentServer.id);
            if (updatedCurrentServer) {
              set({ currentServer: updatedCurrentServer });
            } else {
              // Если текущего сервера больше нет, сбрасываем его
              set({ currentServer: null, currentChannel: null });
            }
          }

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
          
          // Показываем уведомление
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Приглашение в канал`, {
              body: `${data.invited_by} пригласил вас в канал "${data.channel_name}"`,
              icon: '/favicon.ico'
            });
          }
          
          // Перезагружаем список серверов
          get().loadServers();
        });
        
        // Обработка создания нового сервера
        websocketService.onServerCreated((data) => {
          console.log('Создан новый сервер:', data);
          
          // Показываем уведомление
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Новый сервер`, {
              body: `${data.created_by.username} создал сервер "${data.server.name}"`,
              icon: '/favicon.ico'
            });
          }
          
          // Добавляем новый сервер в список
          const newServer: Server = {
            id: data.server.id,
            name: data.server.name,
            description: data.server.description,
            channels: []
          };
          get().addServer(newServer);
        });
        
        // Обработка создания текстового канала
        websocketService.onTextChannelCreated((data) => {
          console.log('Создан новый текстовый канал:', data);
          
          // Показываем уведомление
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Новый текстовый канал`, {
              body: `${data.created_by.username} создал канал #${data.text_channel.name}`,
              icon: '/favicon.ico'
            });
          }
          
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
          console.log('Создан новый голосовой канал:', data);
          
          // Показываем уведомление
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Новый голосовой канал`, {
              body: `${data.created_by.username} создал голосовой канал ${data.voice_channel.name}`,
              icon: '/favicon.ico'
            });
          }
          
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
          
          // Показываем уведомление
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Голосовой канал`, {
              body: `${data.username} присоединился к каналу "${data.voice_channel_name}"`,
              icon: '/favicon.ico'
            });
          }
          
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('voice_channel_join', { detail: data }));
        });
        
        // Обработка выхода из голосового канала
        websocketService.onVoiceChannelLeave((data) => {
          console.log('Пользователь покинул голосовой канал:', data);
          
          // Показываем уведомление
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Голосовой канал`, {
              body: `${data.username} покинул голосовой канал`,
              icon: '/favicon.ico'
            });
          }
          
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('voice_channel_leave', { detail: data }));
        });

        // Обработка начала демонстрации экрана
        websocketService.onScreenShareStarted((data) => {
          console.log('Пользователь начал демонстрацию экрана:', data);
          
          // Показываем уведомление
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Демонстрация экрана`, {
              body: `${data.username} начал демонстрацию экрана`,
              icon: '/favicon.ico'
            });
          }
          
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('screen_share_start', { detail: data }));
        });

        // Обработка остановки демонстрации экрана
        websocketService.onScreenShareStopped((data) => {
          console.log('Пользователь остановил демонстрацию экрана:', data);
          
          // Показываем уведомление
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`Демонстрация экрана`, {
              body: `${data.username} остановил демонстрацию экрана`,
              icon: '/favicon.ico'
            });
          }
          
          // Генерируем глобальное событие для обновления UI
          window.dispatchEvent(new CustomEvent('screen_share_stop', { detail: data }));
        });

        websocketService.onNewMessage((message) => {
          console.log('Новое сообщение:', message);
          get().addMessage(message);

          // Убираем пользователя из списка печатающих, когда он отправил сообщение
          if (message.author) {
            get().clearTyping(message.channelId, message.author.username);
          }
        });

        websocketService.onTyping((data) => {
          const { user } = get();
          // Не показывать свой собственный статус печати
          if (user?.id !== data.user.id) {
            get().setTyping(data.text_channel_id, data.user.username);
          }
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