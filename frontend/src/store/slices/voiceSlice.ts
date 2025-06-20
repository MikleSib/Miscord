import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { VoiceUser } from '../../types';

interface VoiceState {
  isConnected: boolean;
  currentVoiceChannelId: number | null;
  participants: VoiceUser[];
  localStream: MediaStream | null;
  isMuted: boolean;
  isDeafened: boolean;
  error: string | null;
}

const initialState: VoiceState = {
  isConnected: false,
  currentVoiceChannelId: null,
  participants: [],
  localStream: null,
  isMuted: false,
  isDeafened: false,
  error: null,
};

const voiceSlice = createSlice({
  name: 'voice',
  initialState,
  reducers: {
    connectToVoiceChannel: (state, action: PayloadAction<number>) => {
      state.currentVoiceChannelId = action.payload;
      state.isConnected = true;
      state.error = null;
    },
    disconnectFromVoiceChannel: (state) => {
      state.isConnected = false;
      state.currentVoiceChannelId = null;
      state.participants = [];
      state.localStream = null;
      state.isMuted = false;
      state.isDeafened = false;
    },
    setParticipants: (state, action: PayloadAction<VoiceUser[]>) => {
      state.participants = action.payload;
    },
    addParticipant: (state, action: PayloadAction<VoiceUser>) => {
      if (!state.participants.find(p => p.user_id === action.payload.user_id)) {
        state.participants.push(action.payload);
      }
    },
    removeParticipant: (state, action: PayloadAction<number>) => {
      state.participants = state.participants.filter(p => p.user_id !== action.payload);
    },
    updateParticipant: (state, action: PayloadAction<VoiceUser>) => {
      const index = state.participants.findIndex(p => p.user_id === action.payload.user_id);
      if (index !== -1) {
        state.participants[index] = action.payload;
      }
    },
    setLocalStream: (state, action: PayloadAction<MediaStream | null>) => {
      state.localStream = action.payload;
    },
    toggleMute: (state) => {
      state.isMuted = !state.isMuted;
    },
    toggleDeafen: (state) => {
      state.isDeafened = !state.isDeafened;
      if (state.isDeafened) {
        state.isMuted = true;
      }
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
});

export const {
  connectToVoiceChannel,
  disconnectFromVoiceChannel,
  setParticipants,
  addParticipant,
  removeParticipant,
  updateParticipant,
  setLocalStream,
  toggleMute,
  toggleDeafen,
  setError,
} = voiceSlice.actions;

export default voiceSlice.reducer;