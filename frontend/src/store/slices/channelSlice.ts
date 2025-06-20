import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface Channel {
  id: number
  name: string
  type: 'text' | 'voice'
  server_id: number
}

interface ChannelState {
  channels: Channel[]
  currentChannel: Channel | null
  loading: boolean
  error: string | null
}

const initialState: ChannelState = {
  channels: [],
  currentChannel: null,
  loading: false,
  error: null,
}

const channelSlice = createSlice({
  name: 'channel',
  initialState,
  reducers: {
    setChannels: (state, action: PayloadAction<Channel[]>) => {
      state.channels = action.payload
    },
    setCurrentChannel: (state, action: PayloadAction<Channel>) => {
      state.currentChannel = action.payload
    },
    addChannel: (state, action: PayloadAction<Channel>) => {
      state.channels.push(action.payload)
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
  },
})

export const { setChannels, setCurrentChannel, addChannel, setLoading, setError } = channelSlice.actions
export default channelSlice.reducer 