import { create } from 'zustand';
// import chatService from '../services/chatService';
import { Message, Reaction } from '../types';
import { channelApi } from '../services/api';

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
  updateMessageReactions: (messageId: number, reactions: Reaction[]) => void;
  updateSingleReaction: (messageId: number, emoji: string, reaction: Reaction) => void;
  deleteMessage: (messageId: number) => void;
  editMessage: (messageId: number, content: string) => void;
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
      const result = await channelApi.getChannelMessages(channelId, 50);
      set({ 
        messages: result.messages || [],
        isLoading: false 
      });
    } catch (error) {
      set({ 
        error: 'Не удалось загрузить историю сообщений',
        isLoading: false 
      });
    }
  },

  updateMessageReactions: (messageId, reactions) => set((state) => ({
    messages: state.messages.map(message => 
      message.id === messageId 
        ? { ...message, reactions }
        : message
    ),
  })),

  updateSingleReaction: (messageId: number, emoji: string, reaction: Reaction) => set((state) => ({
    messages: state.messages.map(message => {
      if (message.id === messageId) {
        const existingReactions = message.reactions || [];
        const existingReactionIndex = existingReactions.findIndex(r => r.emoji === emoji);
        
        let updatedReactions;
        if (reaction.count === 0) {
          // Убираем реакцию если count = 0
          updatedReactions = existingReactions.filter(r => r.emoji !== emoji);
        } else if (existingReactionIndex >= 0) {
          // Обновляем существующую реакцию
          updatedReactions = [...existingReactions];
          updatedReactions[existingReactionIndex] = reaction;
        } else {
          // Добавляем новую реакцию
          updatedReactions = [...existingReactions, reaction];
        }
        
        return { ...message, reactions: updatedReactions };
      }
      return message;
    }),
  })),

  deleteMessage: (messageId) => set((state) => ({
    messages: state.messages.filter(message => message.id !== messageId),
  })),

  editMessage: (messageId, content) => set((state) => ({
    messages: state.messages.map(message => 
      message.id === messageId 
        ? { ...message, content, is_edited: true }
        : message
    ),
  })),
})); 