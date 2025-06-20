import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Message, User } from '../../types';

interface ChatState {
  messages: { [textChannelId: number]: Message[] };
  typingUsers: { [textChannelId: number]: User[] };
  isLoading: boolean;
  error: string | null;
}

const initialState: ChatState = {
  messages: {},
  typingUsers: {},
  isLoading: false,
  error: null,
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    addMessage: (state, action: PayloadAction<Message>) => {
      const { text_channel_id } = action.payload;
      if (!state.messages[text_channel_id]) {
        state.messages[text_channel_id] = [];
      }
      state.messages[text_channel_id].push(action.payload);
    },
    setMessages: (state, action: PayloadAction<{ textChannelId: number; messages: Message[] }>) => {
      const { textChannelId, messages } = action.payload;
      state.messages[textChannelId] = messages;
    },
    updateMessage: (state, action: PayloadAction<Message>) => {
      const { text_channel_id, id } = action.payload;
      if (state.messages[text_channel_id]) {
        const index = state.messages[text_channel_id].findIndex(msg => msg.id === id);
        if (index !== -1) {
          state.messages[text_channel_id][index] = action.payload;
        }
      }
    },
    deleteMessage: (state, action: PayloadAction<{ textChannelId: number; messageId: number }>) => {
      const { textChannelId, messageId } = action.payload;
      if (state.messages[textChannelId]) {
        state.messages[textChannelId] = state.messages[textChannelId].filter(
          msg => msg.id !== messageId
        );
      }
    },
    addTypingUser: (state, action: PayloadAction<{ textChannelId: number; user: User }>) => {
      const { textChannelId, user } = action.payload;
      if (!state.typingUsers[textChannelId]) {
        state.typingUsers[textChannelId] = [];
      }
      if (!state.typingUsers[textChannelId].find(u => u.id === user.id)) {
        state.typingUsers[textChannelId].push(user);
      }
    },
    removeTypingUser: (state, action: PayloadAction<{ textChannelId: number; userId: number }>) => {
      const { textChannelId, userId } = action.payload;
      if (state.typingUsers[textChannelId]) {
        state.typingUsers[textChannelId] = state.typingUsers[textChannelId].filter(
          u => u.id !== userId
        );
      }
    },
    clearMessages: (state, action: PayloadAction<number>) => {
      const textChannelId = action.payload;
      delete state.messages[textChannelId];
      delete state.typingUsers[textChannelId];
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
});

export const {
  addMessage,
  setMessages,
  updateMessage,
  deleteMessage,
  addTypingUser,
  removeTypingUser,
  clearMessages,
  setError,
  setLoading,
} = chatSlice.actions;

export default chatSlice.reducer;