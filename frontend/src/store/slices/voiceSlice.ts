import { create } from 'zustand';
import { VoiceUser } from '../../types';

interface VoiceState {
  isConnected: boolean;
  currentVoiceChannelId: number | null;
  participants: VoiceUser[];
  localStream: MediaStream | null;
  isMuted: boolean;
  isDeafened: boolean;
  error: string | null;
  connectToVoiceChannel: (channelId: number) => void;
  disconnectFromVoiceChannel: () => void;
  setParticipants: (participants: VoiceUser[]) => void;
  addParticipant: (participant: VoiceUser) => void;
  removeParticipant: (userId: number) => void;
  updateParticipant: (participant: VoiceUser) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setError: (error: string | null) => void;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  isConnected: false,
  currentVoiceChannelId: null,
  participants: [],
  localStream: null,
  isMuted: false,
  isDeafened: false,
  error: null,
  
  connectToVoiceChannel: (channelId) => set({
    currentVoiceChannelId: channelId,
    isConnected: true,
    error: null,
  }),
  
  disconnectFromVoiceChannel: () => set({
    isConnected: false,
    currentVoiceChannelId: null,
    participants: [],
    localStream: null,
    isMuted: false,
    isDeafened: false,
  }),
  
  setParticipants: (participants) => set({ participants }),
  
  addParticipant: (participant) => set((state) => ({
    participants: state.participants.find(p => p.user_id === participant.user_id)
      ? state.participants
      : [...state.participants, participant],
  })),
  
  removeParticipant: (userId) => set((state) => ({
    participants: state.participants.filter(p => p.user_id !== userId),
  })),
  
  updateParticipant: (participant) => set((state) => {
    const index = state.participants.findIndex(p => p.user_id === participant.user_id);
    if (index !== -1) {
      const newParticipants = [...state.participants];
      newParticipants[index] = participant;
      return { participants: newParticipants };
    }
    return state;
  }),
  
  setLocalStream: (stream) => set({ localStream: stream }),
  
  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
  
  toggleDeafen: () => set((state) => ({
    isDeafened: !state.isDeafened,
    isMuted: !state.isDeafened ? true : state.isMuted,
  })),
  
  setError: (error) => set({ error }),
}));