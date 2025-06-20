import { create } from 'zustand';

interface User {
  id: string;
  username: string;
  avatar?: string;
}

interface Server {
  id: string;
  name: string;
  icon?: string;
  channels: Channel[];
}

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  serverId: string;
}

interface Message {
  id: string;
  content: string;
  user: User;
  timestamp: string;
  channelId: string;
}

interface AppState {
  servers: Server[];
  currentServer: Server | null;
  currentChannel: Channel | null;
  messages: Record<string, Message[]>;
  user: User | null;
  selectServer: (serverId: string) => void;
  selectChannel: (channelId: string) => void;
  addServer: (server: Server) => void;
  addChannel: (serverId: string, channel: Channel) => void;
  sendMessage: (content: string) => void;
  addMessage: (channelId: string, message: Message) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  servers: [],
  currentServer: null,
  currentChannel: null,
  messages: {},
  user: null,
  
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
    set((state) => ({
      servers: state.servers.map(server => 
        server.id === serverId 
          ? { ...server, channels: [...server.channels, channel] }
          : server
      ),
    }));
  },
  
  sendMessage: (content) => {
    const { currentChannel, user } = get();
    if (currentChannel && user) {
      const message: Message = {
        id: Date.now().toString(),
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
})); 