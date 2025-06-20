import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import channelReducer from './slices/channelSlice';
import chatReducer from './slices/chatSlice';
import voiceReducer from './slices/voiceSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    channels: channelReducer,
    chat: chatReducer,
    voice: voiceReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;