import { create } from 'zustand';

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  serverId: string;
  messages?: Message[];
}

interface Message {
  id: string;
  content: string;
  userId: string;
  username: string;
  timestamp: string;
  channelId: string;
}

interface ChannelState {
  channels: Channel[];
  currentChannel: Channel | null;
  isLoading: boolean;
  error: string | null;
  setChannels: (channels: Channel[]) => void;
  addChannel: (channel: Channel) => void;
  setCurrentChannel: (channel: Channel) => void;
  addMessage: (message: Message) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  channels: [],
  currentChannel: null,
  isLoading: false,
  error: null,
  
  setChannels: (channels) => set({ channels }),
  
  addChannel: (channel) => set((state) => ({
    channels: [...state.channels, channel],
  })),
  
  setCurrentChannel: (channel) => set({ currentChannel: channel }),
  
  addMessage: (message) => set((state) => {
    const updatedChannels = state.channels.map(channel => {
      if (channel.id === message.channelId) {
        return {
          ...channel,
          messages: [...(channel.messages || []), message],
        };
      }
      return channel;
    });
    
    const updatedCurrentChannel = state.currentChannel?.id === message.channelId
      ? {
          ...state.currentChannel,
          messages: [...(state.currentChannel.messages || []), message],
        }
      : state.currentChannel;
    
    return {
      channels: updatedChannels,
      currentChannel: updatedCurrentChannel,
    };
  }),
  
  setLoading: (loading) => set({ isLoading: loading }),
  
  setError: (error) => set({ error }),
})); 