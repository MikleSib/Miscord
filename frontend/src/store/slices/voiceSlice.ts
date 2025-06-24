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
  wasMutedBeforeDeafen: boolean;
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
  wasMutedBeforeDeafen: false,
  error: null,
  speakingUsers: new Set(),
  
  connectToVoiceChannel: async (channelId) => {
    try {
      set({ error: null });
      
      const token = useAuthStore.getState().token;
      if (!token) {
        throw new Error('Не авторизован');
      }

      // Настраиваем обработчики событий
      voiceService.onParticipantJoin((participant) => {
        get().addParticipant({
          user_id: participant.user_id,
          username: participant.username,
          display_name: participant.display_name,
          avatar_url: participant.avatar_url,
          is_muted: false,
          is_deafened: false,
        });
      });

      voiceService.onParticipantLeave((userId) => {
        get().removeParticipant(userId);
      });
      
      // Обработчик изменения голосовой активности
      voiceService.onSpeakingChange((userId, isSpeaking) => {
        get().setSpeaking(userId, isSpeaking);
      });
      
      // Обработчик получения списка участников
      voiceService.onParticipantsReceived((participants) => {
        // Добавляем текущего пользователя если его нет в списке
        const currentUser = useAuthStore.getState().user;
        if (currentUser) {
          const hasCurrentUser = participants.some((p: any) => p.user_id === currentUser.id);
          if (!hasCurrentUser) {
            participants.push({
              user_id: currentUser.id,
              username: currentUser.display_name || currentUser.username,
              display_name: currentUser.display_name,
              avatar_url: currentUser.avatar_url,
              is_muted: get().isMuted,
              is_deafened: get().isDeafened,
            });
          }
        }
        
        get().setParticipants(participants);
      });
      
      // Обработчик изменения статуса участников
      voiceService.onParticipantStatusChanged((userId, status) => {
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
      
      // Добавляем текущего пользователя в список участников
      const currentUser = useAuthStore.getState().user;
      if (currentUser) {
        get().addParticipant({
          user_id: currentUser.id,
          username: currentUser.display_name || currentUser.username,
          display_name: currentUser.display_name,
          avatar_url: currentUser.avatar_url,
          is_muted: get().isMuted,
          is_deafened: get().isDeafened,
        });
      }
      
      set({
        currentVoiceChannelId: channelId,
        isConnected: true,
        error: null,
      });
    } catch (error: any) {
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
      wasMutedBeforeDeafen: false,
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
    const currentState = get();
    const newMuted = !currentState.isMuted;
    
    // Если включаем микрофон (newMuted = false) и наушники включены, то выключаем наушники
    let newDeafened = currentState.isDeafened;
    if (!newMuted && currentState.isDeafened) {
      newDeafened = false;
      voiceService.setDeafened(false);
    }
    
    voiceService.setMuted(newMuted);
    
    set({ 
      isMuted: newMuted,
      isDeafened: newDeafened,
    });
    
    // Обновляем состояние текущего пользователя в списке участников
    const currentUser = useAuthStore.getState().user;
    if (currentUser) {
      const currentParticipants = get().participants;
      const existingParticipant = currentParticipants.find(p => p.user_id === currentUser.id);
      
      if (existingParticipant) {
        // Обновляем существующего участника
        get().updateParticipant({
          user_id: currentUser.id,
          username: currentUser.display_name || currentUser.username,
          display_name: currentUser.display_name,
          avatar_url: currentUser.avatar_url,
          is_muted: newMuted,
          is_deafened: newDeafened,
        });
      } else {
        // Добавляем участника если его нет в списке
        get().addParticipant({
          user_id: currentUser.id,
          username: currentUser.display_name || currentUser.username,
          display_name: currentUser.display_name,
          avatar_url: currentUser.avatar_url,
          is_muted: newMuted,
          is_deafened: newDeafened,
        });
      }
    }
  },
  
  toggleDeafen: () => {
    const currentState = get();
    const newDeafened = !currentState.isDeafened;
    
    let newMuted = currentState.isMuted;
    let newWasMutedBeforeDeafen = currentState.wasMutedBeforeDeafen;
    
    if (newDeafened) {
      // Включаем deafen - запоминаем текущее состояние микрофона и выключаем его
      newWasMutedBeforeDeafen = currentState.isMuted;
      newMuted = true;
    } else {
      // Выключаем deafen - возвращаем предыдущее состояние микрофона
      newMuted = currentState.wasMutedBeforeDeafen;
    }
    
    voiceService.setDeafened(newDeafened);
    voiceService.setMuted(newMuted);
    
    set({
      isDeafened: newDeafened,
      isMuted: newMuted,
      wasMutedBeforeDeafen: newWasMutedBeforeDeafen,
    });
    
    // Обновляем состояние текущего пользователя в списке участников
    const currentUser = useAuthStore.getState().user;
    if (currentUser) {
      const currentParticipants = get().participants;
      const existingParticipant = currentParticipants.find(p => p.user_id === currentUser.id);
      
      if (existingParticipant) {
        // Обновляем существующего участника
        get().updateParticipant({
          user_id: currentUser.id,
          username: currentUser.display_name || currentUser.username,
          display_name: currentUser.display_name,
          avatar_url: currentUser.avatar_url,
          is_muted: newMuted,
          is_deafened: newDeafened,
        });
      } else {
        // Добавляем участника если его нет в списке
        get().addParticipant({
          user_id: currentUser.id,
          username: currentUser.display_name || currentUser.username,
          display_name: currentUser.display_name,
          avatar_url: currentUser.avatar_url,
          is_muted: newMuted,
          is_deafened: newDeafened,
        });
      }
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