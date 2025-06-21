import { create } from 'zustand';
import channelService from '../services/channelService';

interface User {
  id: number;
  username: string;
  avatar?: string;
}

interface Server {
  id: number;
  name: string;
  icon?: string;
  channels: Channel[];
}

interface Channel {
  id: number;
  name: string;
  type: 'text' | 'voice';
  serverId: number;
}

interface Message {
  id: number;
  content: string;
  user: User;
  timestamp: string;
  channelId: number;
}

interface AppState {
  servers: Server[];
  currentServer: Server | null;
  currentChannel: Channel | null;
  messages: Record<number, Message[]>;
  user: User | null;
  isLoading: boolean;
  error: string | null;
  selectServer: (serverId: number) => void;
  selectChannel: (channelId: number) => void;
  addServer: (server: Server) => void;
  addChannel: (serverId: number, channel: Channel) => void;
  sendMessage: (content: string) => void;
  addMessage: (channelId: number, message: Message) => void;
  setUser: (user: User) => void;
  logout: () => void;
  loadChannels: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useStore = create<AppState>((set, get) => ({
  servers: [],
  currentServer: null,
  currentChannel: null,
  messages: {},
  user: null,
  isLoading: false,
  error: null,
  
  selectServer: (serverId) => {
    const server = get().servers.find(s => s.id === serverId);
    set({ currentServer: server || null, currentChannel: null });
  },
  
  selectChannel: (channelId) => {
    const { currentServer } = get();
    if (currentServer) {
      const channel = currentServer.channels.find(c => c.id === channelId);
      set({ currentChannel: channel || null });
    }
  },
  
  addServer: (server) => {
    set((state) => ({
      servers: [...state.servers, server],
    }));
  },
  
  addChannel: (serverId, channel) => {
    set((state) => {
      const updatedServers = state.servers.map(server => 
        server.id === serverId 
          ? { ...server, channels: [...server.channels, channel] }
          : server
      );
      
      // Также обновляем currentServer, если канал добавляется в текущий сервер
      const updatedCurrentServer = state.currentServer?.id === serverId 
        ? updatedServers.find(s => s.id === serverId) || state.currentServer
        : state.currentServer;
      
      return {
        servers: updatedServers,
        currentServer: updatedCurrentServer,
      };
    });
  },
  
  sendMessage: (content) => {
    const { currentChannel, user } = get();
    if (currentChannel && user) {
      const message: Message = {
        id: Date.now(),
        content,
        user,
        timestamp: new Date().toISOString(),
        channelId: currentChannel.id,
      };
      get().addMessage(currentChannel.id, message);
    }
  },
  
  addMessage: (channelId, message) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: [...(state.messages[channelId] || []), message],
      },
    }));
  },
  
  setUser: (user) => {
    set({ user });
  },
  
  logout: () => {
    set({ user: null, currentServer: null, currentChannel: null, messages: {} });
  },

  loadChannels: async () => {
    set({ isLoading: true, error: null });
    try {
      const channels = await channelService.getUserChannels();
      
      // Преобразуем каналы в формат серверов
      const servers: Server[] = channels.map(channel => ({
        id: channel.id,
        name: channel.name,
        icon: undefined, // Пока нет иконок
        channels: [
          ...channel.text_channels.map(tc => ({
            id: tc.id,
            name: tc.name,
            type: 'text' as const,
            serverId: channel.id,
          })),
          ...channel.voice_channels.map(vc => ({
            id: vc.id,
            name: vc.name,
            type: 'voice' as const,
            serverId: channel.id,
          })),
        ],
      }));
      
      set({ servers, isLoading: false });
    } catch (error: any) {
      set({ 
        error: error.response?.data?.detail || 'Ошибка загрузки каналов', 
        isLoading: false 
      });
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),
  
  setError: (error) => set({ error }),
})); 