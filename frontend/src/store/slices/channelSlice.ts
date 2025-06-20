import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import channelService from '../../services/channelService';
import { Channel, TextChannel, VoiceChannel } from '../../types';

interface ChannelState {
  channels: Channel[];
  currentChannel: Channel | null;
  currentTextChannel: TextChannel | null;
  currentVoiceChannel: VoiceChannel | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: ChannelState = {
  channels: [],
  currentChannel: null,
  currentTextChannel: null,
  currentVoiceChannel: null,
  isLoading: false,
  error: null,
};

export const fetchChannels = createAsyncThunk(
  'channels/fetchChannels',
  async () => {
    const channels = await channelService.getMyChannels();
    return channels;
  }
);

export const fetchChannel = createAsyncThunk(
  'channels/fetchChannel',
  async (channelId: number) => {
    const channel = await channelService.getChannel(channelId);
    return channel;
  }
);

export const createChannel = createAsyncThunk(
  'channels/createChannel',
  async (data: { name: string; description?: string }) => {
    const channel = await channelService.createChannel(data);
    return channel;
  }
);

export const joinChannel = createAsyncThunk(
  'channels/joinChannel',
  async (channelId: number) => {
    await channelService.joinChannel(channelId);
    const channel = await channelService.getChannel(channelId);
    return channel;
  }
);

const channelSlice = createSlice({
  name: 'channels',
  initialState,
  reducers: {
    setCurrentChannel: (state, action: PayloadAction<Channel | null>) => {
      state.currentChannel = action.payload;
      if (action.payload && action.payload.text_channels.length > 0) {
        state.currentTextChannel = action.payload.text_channels[0];
      } else {
        state.currentTextChannel = null;
      }
    },
    setCurrentTextChannel: (state, action: PayloadAction<TextChannel | null>) => {
      state.currentTextChannel = action.payload;
    },
    setCurrentVoiceChannel: (state, action: PayloadAction<VoiceChannel | null>) => {
      state.currentVoiceChannel = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch channels
      .addCase(fetchChannels.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchChannels.fulfilled, (state, action) => {
        state.isLoading = false;
        state.channels = action.payload;
      })
      .addCase(fetchChannels.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch channels';
      })
      // Fetch channel
      .addCase(fetchChannel.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchChannel.fulfilled, (state, action) => {
        state.isLoading = false;
        state.currentChannel = action.payload;
        if (action.payload.text_channels.length > 0) {
          state.currentTextChannel = action.payload.text_channels[0];
        }
      })
      .addCase(fetchChannel.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch channel';
      })
      // Create channel
      .addCase(createChannel.fulfilled, (state, action) => {
        state.channels.push(action.payload);
      })
      // Join channel
      .addCase(joinChannel.fulfilled, (state, action) => {
        state.channels.push(action.payload);
      });
  },
});

export const { setCurrentChannel, setCurrentTextChannel, setCurrentVoiceChannel, clearError } = channelSlice.actions;
export default channelSlice.reducer;