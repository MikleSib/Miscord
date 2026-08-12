import { create } from 'zustand';
import { useOutgoingMessageStore } from './outgoingMessageStore';
import { persist } from 'zustand/middleware';
import { Server, Channel, User } from '../types';
import websocketService from '../services/websocketService';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  loginStart: () => void;
  loginSuccess: (user: User, token: string) => void;
  loginFailure: (error: string) => void;
  registerStart: () => void;
  registerSuccess: () => void;
  registerFailure: (error: string) => void;
  logout: () => void;
  setUser: (user: User) => void;
  updateUser: (user: User) => void;
  clearError: () => void;
  setToken: (token: string) => void;
}

interface StoreState {
  servers: Server[];
  currentServer: Server | null;
  currentChannel: Channel | null;
  voiceChannelUsers: { [channelId: number]: Array<{ user_id: number; username: string }> };
  setServers: (servers: Server[]) => void;
  selectServer: (serverId: number) => void;
  selectChannel: (channelId: number, channelType?: 'text' | 'voice') => void;
  addChannel: (serverId: number, channel: Channel) => void;
  loadServers: () => Promise<void>;
  addUserToVoiceChannel: (channelId: number, user: { user_id: number; username: string }) => void;
  removeUserFromVoiceChannel: (channelId: number, userId: number) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      loginStart: () => set({ isLoading: true, error: null }),
      loginSuccess: (user, token) => set({
        isLoading: false,
        isAuthenticated: true,
        user,
        token,
        error: null,
      }),
      loginFailure: (error) => set({ isLoading: false, error }),
      registerStart: () => set({ isLoading: true, error: null }),
      registerSuccess: () => set({ isLoading: false }),
      registerFailure: (error) => set({ isLoading: false, error }),
      logout: () => {
        const token = get().token;
        if (typeof window !== 'undefined') {
          void fetch('/api/v1/auth/logout', {
            method: 'POST',
            credentials: 'include',
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          }).catch(() => undefined);
        }
        websocketService.fullDisconnect();
        void useOutgoingMessageStore.getState().clearForLogout();
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          error: null,
        });
      },
      setUser: (user) => set({ user, isAuthenticated: true }),
      updateUser: (user) => set({ user }),
      clearError: () => set({ error: null }),
      setToken: (token) => set({ token }),
    }),
    {
      name: 'auth-storage',
      partialize: () => ({}),
      version: 2,
      migrate: () => ({}),
      skipHydration: false, // Включаем гидратацию для восстановления состояния
    }
  )
);

export const useStore = create<StoreState>((set, get) => ({
  servers: [],
  currentServer: null,
  currentChannel: null,
  voiceChannelUsers: {},
  
  setServers: (servers) => set({ servers }),
  
  selectServer: (serverId) => {
    const server = get().servers.find(s => s.id === serverId);
    if (server) {
      set({ currentServer: server, currentChannel: null });
    }
  },
  
  selectChannel: (channelId, channelType) => {
    console.log('[Store] selectChannel вызван с channelId:', channelId, 'type:', channelType);
    const currentServer = get().currentServer;
    console.log('[Store] currentServer:', currentServer);
    if (currentServer) {
      const channel = currentServer.channels.find(
        (c) => c.id === channelId && (channelType ? c.type === channelType : true)
      );
      console.log('[Store] найден канал:', channel);
      if (channel) {
        console.log('[Store] устанавливаем currentChannel:', channel);
        set({ currentChannel: channel });
      } else {
        console.warn('[Store] канал не найден среди каналов сервера:', currentServer.channels);
      }
    } else {
      console.warn('[Store] currentServer не установлен!');
    }
  },
  
  addChannel: (serverId, channel) => {
    set((state) => ({
      servers: state.servers.map(server =>
        server.id === serverId
          ? { ...server, channels: [...server.channels, channel] }
          : server
      )
    }));
  },
  
  loadServers: async () => {
    // Реализация загрузки серверов
    // Пока оставим пустой
  },
  
  addUserToVoiceChannel: (channelId, user) => {
    set((state) => ({
      voiceChannelUsers: {
        ...state.voiceChannelUsers,
        [channelId]: [
          ...(state.voiceChannelUsers[channelId] || []).filter(u => u.user_id !== user.user_id),
          user
        ]
      }
    }));
  },
  
  removeUserFromVoiceChannel: (channelId, userId) => {
    set((state) => ({
      voiceChannelUsers: {
        ...state.voiceChannelUsers,
        [channelId]: (state.voiceChannelUsers[channelId] || []).filter(u => u.user_id !== userId)
      }
    }));
  },
})); 
