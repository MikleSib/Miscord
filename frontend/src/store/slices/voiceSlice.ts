import { create } from 'zustand';
import { VoiceUser } from '../../types';
import voiceService from '../../services/voiceService';
import { useAuthStore } from '../store';

interface VoiceState {
  isConnected: boolean;
  currentVoiceChannelId: number | null;
  participants: VoiceUser[];
  localStream: MediaStream | null;
  isMuted: boolean;
  isDeafened: boolean;
  error: string | null;
  speakingUsers: Set<number>;
  connectToVoiceChannel: (channelId: number) => Promise<void>;
  disconnectFromVoiceChannel: () => void;
  setParticipants: (participants: VoiceUser[]) => void;
  addParticipant: (participant: VoiceUser) => void;
  removeParticipant: (userId: number) => void;
  updateParticipant: (participant: VoiceUser) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setError: (error: string | null) => void;
  setSpeaking: (userId: number, isSpeaking: boolean) => void;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  isConnected: false,
  currentVoiceChannelId: null,
  participants: [],
  localStream: null,
  isMuted: false,
  isDeafened: false,
  error: null,
  speakingUsers: new Set(),
  
  connectToVoiceChannel: async (channelId) => {
    try {
      console.log('🎙️ Попытка подключения к голосовому каналу:', channelId);
      set({ error: null });
      
      const token = useAuthStore.getState().token;
      if (!token) {
        throw new Error('Не авторизован');
      }

      console.log('🎙️ Токен получен, настраиваем обработчики событий');

      // Настраиваем обработчики событий
      voiceService.onParticipantJoin((userId, username) => {
        console.log('🎙️ Участник присоединился:', userId, username);
        get().addParticipant({
          user_id: userId,
          username,
          is_muted: false,
          is_deafened: false,
        });
      });

      voiceService.onParticipantLeave((userId) => {
        console.log('🎙️ Участник покинул канал:', userId);
        get().removeParticipant(userId);
      });

      console.log('🎙️ Подключаемся к голосовому каналу через voiceService');
      
      // Обработчик изменения голосовой активности
      voiceService.onSpeakingChange((userId, isSpeaking) => {
        console.log('🎙️ Изменение голосовой активности:', userId, isSpeaking);
        get().setSpeaking(userId, isSpeaking);
      });
      
      // Обработчик получения списка участников
      voiceService.onParticipantsReceived((participants) => {
        console.log('🎙️ Получен список участников:', participants);
        get().setParticipants(participants);
      });
      
      // Обработчик изменения статуса участников
      voiceService.onParticipantStatusChanged((userId, status) => {
        console.log('🎙️ Изменение статуса участника:', userId, status);
        const currentParticipants = get().participants;
        const participantIndex = currentParticipants.findIndex(p => p.user_id === userId);
        
        if (participantIndex !== -1) {
          const updatedParticipant = {
            ...currentParticipants[participantIndex],
            ...status
          };
          get().updateParticipant(updatedParticipant);
        }
      });
      
      // Подключаемся к голосовому каналу
      await voiceService.connect(channelId, token);
      
      console.log('🎙️ Успешно подключились к голосовому каналу');
      
      set({
        currentVoiceChannelId: channelId,
        isConnected: true,
        error: null,
      });

      console.log('🎙️ Состояние обновлено:', {
        currentVoiceChannelId: channelId,
        isConnected: true,
      });
    } catch (error: any) {
      console.error('🎙️ Ошибка подключения к голосовому каналу:', error);
      set({ 
        error: error.message || 'Ошибка подключения к голосовому каналу',
        isConnected: false,
        currentVoiceChannelId: null,
      });
    }
  },
  
  disconnectFromVoiceChannel: () => {
    voiceService.disconnect();
    set({
      isConnected: false,
      currentVoiceChannelId: null,
      participants: [],
      localStream: null,
      isMuted: false,
      isDeafened: false,
      speakingUsers: new Set(),
    });
  },
  
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
  
  toggleMute: () => {
    const newMuted = !get().isMuted;
    voiceService.setMuted(newMuted);
    set({ isMuted: newMuted });
    
    // Обновляем состояние текущего пользователя в списке участников
    const currentUser = useAuthStore.getState().user;
    if (currentUser) {
      get().updateParticipant({
        user_id: currentUser.id,
        username: currentUser.username,
        is_muted: newMuted,
        is_deafened: get().isDeafened,
      });
    }
  },
  
  toggleDeafen: () => {
    const newDeafened = !get().isDeafened;
    voiceService.setDeafened(newDeafened);
    set((state) => ({
      isDeafened: newDeafened,
      isMuted: newDeafened ? true : state.isMuted,
    }));
    
    // Обновляем состояние текущего пользователя в списке участников
    const currentUser = useAuthStore.getState().user;
    if (currentUser) {
      get().updateParticipant({
        user_id: currentUser.id,
        username: currentUser.username,
        is_muted: newDeafened ? true : get().isMuted,
        is_deafened: newDeafened,
      });
    }
  },
  
  setError: (error) => set({ error }),
  
  setSpeaking: (userId, isSpeaking) => {
    set((state) => {
      const newSpeakingUsers = new Set(state.speakingUsers);
      if (isSpeaking) {
        newSpeakingUsers.add(userId);
      } else {
        newSpeakingUsers.delete(userId);
      }
      return { speakingUsers: newSpeakingUsers };
    });
  },
}));