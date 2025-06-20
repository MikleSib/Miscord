import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface Message {
  id: number
  content: string
  user_id: number
  channel_id: number
  created_at: string
  user: {
    username: string
  }
}

interface ChatState {
  messages: Message[]
  loading: boolean
  error: string | null
}

const initialState: ChatState = {
  messages: [],
  loading: false,
  error: null,
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    addMessage: (state, action: PayloadAction<Message>) => {
      state.messages.push(action.payload)
    },
    setMessages: (state, action: PayloadAction<Message[]>) => {
      state.messages = action.payload
    },
    clearMessages: (state) => {
      state.messages = []
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
  },
})

export const { addMessage, setMessages, clearMessages, setLoading, setError } = chatSlice.actions
export default chatSlice.reducer 