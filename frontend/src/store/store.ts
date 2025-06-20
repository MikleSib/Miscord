import { configureStore } from '@reduxjs/toolkit'
import authReducer from './slices/authSlice'
import chatReducer from './slices/chatSlice'
import channelReducer from './slices/channelSlice'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    chat: chatReducer,
    channel: channelReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch 