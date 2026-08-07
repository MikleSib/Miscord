import { create } from 'zustand';
import chatService from '../services/chatService';
import { Message, Reaction } from '../types';

type ChatMessage = Message;

/** Сколько сообщений за один запрос — как в Discord (пачками, не весь чат) */
export const CHAT_PAGE_SIZE = 50;

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  isLoadingOlder: boolean;
  hasMoreOlder: boolean;
  error: string | null;
  currentChannelId: number | null;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  prependMessages: (messages: ChatMessage[]) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setCurrentChannel: (channelId: number | null) => void;
  /** Первая страница: самые свежие сообщения */
  loadMessageHistory: (channelId: number) => Promise<void>;
  /** Следующая пачка старее (при скролле вверх) */
  loadOlderMessages: () => Promise<number>;
  updateMessageReactions: (messageId: number, reactions: Reaction[]) => void;
  updateSingleReaction: (messageId: number, emoji: string, reaction: Reaction) => void;
  deleteMessage: (messageId: number) => void;
  editMessage: (messageId: number, content: string) => void;
}

function dedupeById(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<number>();
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (seen.has(msg.id)) continue;
    seen.add(msg.id);
    out.push(msg);
  }
  return out;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  isLoadingOlder: false,
  hasMoreOlder: false,
  error: null,
  currentChannelId: null,

  setMessages: (messages) => set({ messages }),

  addMessage: (message) =>
    set((state) => {
      // Не дублируем и не кладём чужой канал
      if (
        message.channelId != null &&
        state.currentChannelId != null &&
        message.channelId !== state.currentChannelId
      ) {
        return state;
      }
      if (state.messages.some((m) => m.id === message.id)) {
        return state;
      }
      return { messages: [...state.messages, message] };
    }),

  prependMessages: (messages) =>
    set((state) => ({
      messages: dedupeById([...messages, ...state.messages]),
    })),

  clearMessages: () =>
    set({ messages: [], hasMoreOlder: false, isLoadingOlder: false }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  setCurrentChannel: (channelId) => set({ currentChannelId: channelId }),

  loadMessageHistory: async (channelId: number) => {
    const state = get();

    if (state.currentChannelId !== channelId) {
      set({
        messages: [],
        currentChannelId: channelId,
        hasMoreOlder: false,
        isLoadingOlder: false,
      });
    }

    set({ isLoading: true, error: null });

    try {
      const result = await chatService.loadMessageHistory(
        channelId,
        CHAT_PAGE_SIZE
      );
      // На всякий случай: только этот канал
      const page = (result.messages || []).filter(
        (m: ChatMessage) => m.channelId == null || m.channelId === channelId
      );
      set({
        messages: dedupeById(page),
        hasMoreOlder: Boolean(result.has_more),
        isLoading: false,
        currentChannelId: channelId,
      });
    } catch (error) {
      console.error('Ошибка загрузки истории сообщений:', error);
      set({
        error: 'Не удалось загрузить историю сообщений',
        isLoading: false,
      });
    }
  },

  loadOlderMessages: async () => {
    const {
      messages,
      currentChannelId,
      hasMoreOlder,
      isLoadingOlder,
      isLoading,
    } = get();

    if (
      !currentChannelId ||
      !hasMoreOlder ||
      isLoadingOlder ||
      isLoading ||
      messages.length === 0
    ) {
      return 0;
    }

    const oldestId = messages[0].id;
    set({ isLoadingOlder: true });

    try {
      const result = await chatService.loadMessageHistory(
        currentChannelId,
        CHAT_PAGE_SIZE,
        oldestId
      );
      const existing = new Set(messages.map((m) => m.id));
      const older = (result.messages || []).filter(
        (m: ChatMessage) =>
          !existing.has(m.id) &&
          (m.channelId == null || m.channelId === currentChannelId)
      );

      set({
        messages: [...older, ...messages],
        hasMoreOlder: Boolean(result.has_more),
        isLoadingOlder: false,
      });
      return older.length;
    } catch (error) {
      console.error('Ошибка подгрузки старых сообщений:', error);
      set({ isLoadingOlder: false });
      return 0;
    }
  },

  updateMessageReactions: (messageId, reactions) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId ? { ...message, reactions } : message
      ),
    })),

  updateSingleReaction: (messageId, emoji, reaction) =>
    set((state) => ({
      messages: state.messages.map((message) => {
        if (message.id !== messageId) return message;

        const existingReactions = message.reactions || [];
        const existingReactionIndex = existingReactions.findIndex(
          (r) => r.emoji === emoji
        );

        let updatedReactions;
        if (reaction.count === 0) {
          updatedReactions = existingReactions.filter((r) => r.emoji !== emoji);
        } else if (existingReactionIndex >= 0) {
          updatedReactions = [...existingReactions];
          updatedReactions[existingReactionIndex] = reaction;
        } else {
          updatedReactions = [...existingReactions, reaction];
        }

        return { ...message, reactions: updatedReactions };
      }),
    })),

  deleteMessage: (messageId) =>
    set((state) => ({
      messages: state.messages.filter((message) => message.id !== messageId),
    })),

  editMessage: (messageId, content) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId
          ? { ...message, content, is_edited: true }
          : message
      ),
    })),
}));
