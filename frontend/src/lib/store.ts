import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Server, Channel, Message, User, FullServerData } from '../types';
import channelService from '../services/channelService';
import uploadService from '../services/uploadService';
import chatService from '../services/chatService';
import { useDmNotificationStore } from '../store/dmNotificationStore';
import { useChannelUnreadStore } from '../store/channelUnreadStore';
import type { AppState } from './appStoreTypes';
import { disconnectAppRealtime, initializeAppRealtime } from './appStoreRealtime';
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

        // Если serverId = 0, это означает выбор "Дома" (HomePageContent)
        if (serverId === 0) {
          set({ currentServer: null, currentChannel: null });
          return;
        }

        const server = servers.find(s => s.id === serverId);

        if (server) {
          set({ currentServer: server, currentChannel: null });
          await loadServerDetails(serverId);
          // Подгружаем персональные настройки уведомлений для этого сервера
          void import('../store/notificationSettingsStore').then(({ useNotificationSettingsStore }) => {
            void useNotificationSettingsStore.getState().load(serverId)
          })
        }
      },

      // Выбор канала
      selectChannel: (channelId: number, channelType?: 'text' | 'voice') => {
        const { currentServer, user, currentChannel } = get();
        if (currentServer) {
          // text_channels и voice_channels имеют отдельные id-последовательности,
          // поэтому ищем по паре id + type, иначе general/General оба с id=1 путаются
          const channel = currentServer.channels.find(
            (c) => c.id === channelId && (channelType ? c.type === channelType : true)
          );
          if (channel) {
            const isSameChannel =
              channel.id === currentChannel?.id && channel.type === currentChannel?.type;
            set({ currentChannel: channel });

            // Прочитали канал — убираем «непрочитанное» для обычных сообщений и пингов
            if (channel.type === 'text') {
              useChannelUnreadStore.getState().setViewingTextChannelId(channel.id)
              useChannelUnreadStore.getState().markChannelRead(channel.id)
              void import('../store/mentionNotificationStore').then(({ useMentionNotificationStore }) => {
                useMentionNotificationStore.getState().markChannelRead(channel.id)
              })
            } else {
              useChannelUnreadStore.getState().setViewingTextChannelId(null)
            }

            // Управление WebSocket чата только если это не тот же канал
            if (!isSameChannel) {
              if (channel.type === 'text' && user) {
                const token = localStorage.getItem('access_token');
                if (token) {
                  console.log('[store] Отключаем предыдущее соединение чата');
                  chatService.disconnect();
                  console.log('[store] Подключаемся к текстовому каналу', channel.id, 'с токеном длиной', token.length);
                  chatService.connect(channel.id, token);
                } else {
                  console.error('[store] Токен не найден в localStorage');
                }
              } else if (channel.type === 'voice') {
                // Для голосовых каналов НЕ отключаем чат - пользователь может читать и текстовый канал
                console.log('[store] Выбран голосовой канал', channel.id, '- WebSocket чата не трогаем');
              } else {
                // Для других типов каналов отключаемся от чата
                console.log('[store] Отключаемся от чата (канал типа:', channel.type, ')');
                chatService.disconnect();
              }
            } else {
              console.log('[store] Канал не изменился, WebSocket не трогаем');
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
        console.log('🗑️ removeServer вызван для сервера ID:', serverId);
        set((state) => {
          console.log('🗑️ Состояние до удаления:', {
            serversCount: state.servers.length,
            currentServerId: state.currentServer?.id,
            currentChannelId: state.currentChannel?.id
          });

          const filteredServers = state.servers.filter(server => server.id !== serverId);

          // Если удаляется текущий сервер, сбрасываем выбор
          const isCurrentServer = state.currentServer?.id === serverId;
          const newCurrentServer = isCurrentServer ? null : state.currentServer;
          const newCurrentChannel = isCurrentServer ? null : state.currentChannel;

          console.log('🗑️ Новое состояние:', {
            serversCount: filteredServers.length,
            isCurrentServer,
            newCurrentServerId: newCurrentServer?.id,
            newCurrentChannelId: newCurrentChannel?.id
          });

          return {
            servers: filteredServers,
            currentServer: newCurrentServer,
            currentChannel: newCurrentChannel,
            currentServerMembers: newCurrentServer ? state.currentServerMembers : []
          };
        });
        console.log('🗑️ removeServer завершен');
      },

      // Добавление канала
      addChannel: (serverId: number, channel: Channel) => {
        set((state) => {
          const appendIfMissing = (channels: Channel[]) => {
            // id уникален только внутри типа (text/voice — разные таблицы)
            if (channels.some((c) => c.id === channel.id && c.type === channel.type)) {
              return channels;
            }
            return [...channels, channel];
          };

          const updatedServers = state.servers.map((server) =>
            server.id === serverId
              ? { ...server, channels: appendIfMissing(server.channels) }
              : server
          );

          // Обновляем currentServer напрямую, чтобы список каналов сразу перерисовался
          const updatedCurrentServer =
            state.currentServer?.id === serverId
              ? {
                  ...state.currentServer,
                  channels: appendIfMissing(state.currentServer.channels),
                }
              : state.currentServer;

          return {
            servers: updatedServers,
            currentServer: updatedCurrentServer,
          };
        });
      },

      updateChannel: (serverId, channelId, channelType, updates) => {
        set((state) => {
          const patchChannels = (channels: Channel[]) =>
            channels.map((channel) =>
              channel.id === channelId && channel.type === channelType
                ? { ...channel, ...updates }
                : channel
            );

          const updatedServers = state.servers.map((server) =>
            server.id === serverId
              ? { ...server, channels: patchChannels(server.channels) }
              : server
          );

          const updatedCurrentServer =
            state.currentServer?.id === serverId
              ? {
                  ...state.currentServer,
                  channels: patchChannels(state.currentServer.channels),
                }
              : state.currentServer;

          const updatedCurrentChannel =
            state.currentChannel?.id === channelId &&
            state.currentChannel.type === channelType
              ? { ...state.currentChannel, ...updates }
              : state.currentChannel;

          return {
            servers: updatedServers,
            currentServer: updatedCurrentServer,
            currentChannel: updatedCurrentChannel,
          };
        });
      },

      removeChannel: (serverId, channelId, channelType) => {
        set((state) => {
          const filterChannels = (channels: Channel[]) =>
            channels.filter(
              (channel) =>
                !(channel.id === channelId && channel.type === channelType)
            );

          const updatedServers = state.servers.map((server) =>
            server.id === serverId
              ? { ...server, channels: filterChannels(server.channels) }
              : server
          );

          const updatedCurrentServer =
            state.currentServer?.id === serverId
              ? {
                  ...state.currentServer,
                  channels: filterChannels(state.currentServer.channels),
                }
              : state.currentServer;

          const isCurrent =
            state.currentChannel?.id === channelId &&
            state.currentChannel.type === channelType;

          let nextChannel: Channel | null = state.currentChannel;
          if (isCurrent) {
            const remaining =
              updatedCurrentServer?.channels.filter((c) => c.type === 'text') ?? [];
            nextChannel = remaining[0] ?? null;
          }

          return {
            servers: updatedServers,
            currentServer: updatedCurrentServer,
            currentChannel: nextChannel,
          };
        });
      },

      // Отправка сообщения
      sendMessage: async (content: string, files: File[]) => {
        const { currentChannel, user } = get();
        console.log('[store] sendMessage START', {
          content,
          files,
          currentChannel,
          user,
          channelId: currentChannel?.id,
          channelName: currentChannel?.name,
          channelType: currentChannel?.type,
          userId: user?.id,
          username: user?.username,
        });
        if (!currentChannel || !user || currentChannel.type !== 'text') {
          console.log('[store] return: нет канала, пользователя или не текстовый канал', {
            currentChannel,
            user,
            channelId: currentChannel?.id,
            channelName: currentChannel?.name,
            channelType: currentChannel?.type,
            userId: user?.id,
            username: user?.username,
          });
          return;
        }
        if (!content.trim() && files.length === 0) {
          console.log('[store] return: пустое сообщение и нет файлов');
          return;
        }
        if (content.length > 5000) {
          console.log('[store] return: слишком длинное сообщение');
          get().setError("Сообщение не может быть длиннее 5000 символов.");
          return;
        }
        if (files.length > 3) {
          console.log('[store] return: слишком много файлов');
          get().setError("Можно прикрепить не более 3 изображений.");
          return;
        }

        set({ isLoading: true });
        console.log('[store] после setLoading');
        try {
          const attachmentUrls: string[] = [];
          console.log('[store] attachmentUrls перед циклом:', attachmentUrls, files);
          for (const file of files) {
            console.log('[store] uploadFile вызов', file);
            const response = await uploadService.uploadFile(file);
            console.log('[store] uploadFile ответ', response);
            attachmentUrls.push(response.file_url);
          }
          console.log('[store] Перед отправкой в chatService', { channelId: currentChannel.id, content, attachmentUrls });
          chatService.sendMessage(content, attachmentUrls);
          console.log('[store] После вызова chatService.sendMessage');
        } catch (error) {
          console.error('[store] Ошибка отправки сообщения:', error);
          get().setError("Не удалось отправить сообщение.");
        } finally {
          set({ isLoading: false });
          console.log('[store] sendMessage FINALLY');
        }
      },

      // Добавление сообщения
      addMessage: (message: Message) => {
        if (message.channelId === undefined) {
          console.warn('addMessage: channelId is undefined for message:', message);
          return;
        }
        const channelId = message.channelId;
        set((state) => ({
          messages: {
            ...state.messages,
            [channelId]: [...(state.messages[channelId] || []), message],
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
        useDmNotificationStore.getState().clearAll();
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
        // Полноэкранный лоадер только при первой загрузке — иначе сбрасываются модалки (настройки канала и т.п.)
        const isInitialLoad = get().servers.length === 0
        if (isInitialLoad) {
          set({ isLoading: true, error: null })
        } else {
          set({ error: null })
        }
        try {
          const fullData: FullServerData = await channelService.getFullServerData();
          const servers: Server[] = fullData.servers.map((s: any) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            icon: s.icon,
            banner: s.banner ?? null,
            is_public: Boolean(s.is_public),
            owner_id: s.owner_id,
            created_at: s.created_at,
            channels: [
              ...(s.text_channels || []).map((c: any) => ({
                id: c.id,
                name: c.name,
                type: 'text' as const,
                serverId: s.id,
                position: c.position,
                slow_mode_seconds: c.slow_mode_seconds ?? 0,
                kind: c.kind ?? 'text',
                parent_id: c.parent_id ?? null,
              })),
              ...(s.voice_channels || []).map((c: any) => ({
                id: c.id,
                name: c.name,
                type: 'voice' as const,
                serverId: s.id,
                position: c.position,
                max_users: c.max_users ?? 0,
                bitrate: c.bitrate ?? 64,
                video_quality: c.video_quality === '720p' ? '720p' as const : 'auto' as const,
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
            serverId: serverId,
            position: ch.position,
            slow_mode_seconds: ch.slow_mode_seconds,
            max_users: ch.max_users ?? 0,
            bitrate: ch.bitrate ?? 64,
            video_quality: ch.video_quality === '720p' ? '720p' as const : 'auto' as const,
            kind: ch.kind ?? (ch.type === 'text' ? 'text' : undefined),
            parent_id: ch.parent_id ?? null,
          }))

          const updatedServer: Server = {
            id: serverDetails.id,
            name: serverDetails.name,
            description: serverDetails.description,
            icon: serverDetails.icon,
            banner: serverDetails.banner ?? null,
            is_public: Boolean(serverDetails.is_public),
            owner_id: serverDetails.owner_id,
            created_at: serverDetails.created_at,
            members_count: serverDetails.members_count,
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
      initializeWebSocket: (token: string) => initializeAppRealtime(token, get),
      disconnectWebSocket: () => disconnectAppRealtime()
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
// ПРИМЕЧАНИЕ: Обработчики регистрируются в ChatArea.tsx, здесь только подключаемся
if (typeof window !== 'undefined') {
  const { currentChannel, user } = useStore.getState();
  if (currentChannel && currentChannel.type === 'text' && user) {
    const token = localStorage.getItem('access_token');
    if (token) {
      console.log('[store init] Автоматическое подключение к каналу', currentChannel.id);
      chatService.disconnect();
      chatService.connect(currentChannel.id, token);
    }
  }
}
