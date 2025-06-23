import { create } from 'zustand';
import chatService from '../services/chatService';
import { Message } from '../types';

type ChatMessage = Message;

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  currentChannelId: number | null;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  prependMessages: (messages: ChatMessage[]) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setCurrentChannel: (channelId: number | null) => void;
  loadMessageHistory: (channelId: number) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  error: null,
  currentChannelId: null,
  
  setMessages: (messages) => set({ messages }),
  
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),
  
  prependMessages: (messages) => set((state) => ({
    messages: [...messages, ...state.messages],
  })),
  
  clearMessages: () => set({ messages: [] }),
  
  setLoading: (loading) => set({ isLoading: loading }),
  
  setError: (error) => set({ error }),
  
  setCurrentChannel: (channelId) => set({ currentChannelId: channelId }),
  
  loadMessageHistory: async (channelId: number) => {
    const state = get();
    
    // Если меняется канал, очищаем сообщения
    if (state.currentChannelId !== channelId) {
      set({ messages: [], currentChannelId: channelId });
    }
    
    set({ isLoading: true, error: null });
    
    try {
      const result = await chatService.loadMessageHistory(channelId);
      set({ 
        messages: result.messages,
        isLoading: false 
      });
    } catch (error) {
      console.error('Ошибка загрузки истории сообщений:', error);
      set({ 
        error: 'Не удалось загрузить историю сообщений',
        isLoading: false 
      });
    }
  },
})); 