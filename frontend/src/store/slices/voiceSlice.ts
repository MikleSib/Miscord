import { create } from 'zustand';
import { VoiceUser, User } from '../../types';
import voiceService from '../../services/voiceService';
import { useAuthStore } from '../store';
import soundService from '../../services/soundService';

type CallType = 'channel' | 'p2p' | null;
type P2PCallStatus = 'idle' | 'outgoing' | 'incoming' | 'active';

interface VoiceState {
  isConnected: boolean;
  currentVoiceChannelId: number | null;
  participants: VoiceUser[];
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isDeafened: boolean;
  wasMutedBeforeDeafen: boolean;
  error: string | null;
  speakingUsers: Set<number>;
  
  // P2P Call State
  callType: CallType;
  p2pCallStatus: P2PCallStatus;
  p2pPeer: User | null;

  connectToVoiceChannel: (channelId: number) => Promise<void>;
  disconnectFromVoiceChannel: () => void;
  setParticipants: (participants: VoiceUser[]) => void;
  addParticipant: (participant: VoiceUser) => void;
  removeParticipant: (userId: number) => void;
  updateParticipant: (participant: VoiceUser) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setError: (error: string | null) => void;
  setSpeaking: (userId: number, isSpeaking: boolean) => void;

  // P2P Call Actions
  setOutgoingP2PCall: (peer: User) => void;
  setIncomingP2PCall: (peer: User) => void;
  setP2PCallActive: () => void;
  clearP2PCallState: () => void;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  isConnected: false,
  currentVoiceChannelId: null,
  participants: [],
  localStream: null,
  remoteStream: null,
  isMuted: false,
  isDeafened: false,
  wasMutedBeforeDeafen: false,
  error: null,
  speakingUsers: new Set(),

  // P2P Call State
  callType: null,
  p2pCallStatus: 'idle',
  p2pPeer: null,
  
  connectToVoiceChannel: async (channelId) => {
    try {
      
      // Если уже подключены к каналу, сначала отключаемся
      const currentState = get();
      if (currentState.isConnected || currentState.currentVoiceChannelId) {
        get().disconnectFromVoiceChannel();
        // Ждём завершения отключения
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
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
      await voiceService.connect(channelId, token, get().isMuted, get().isDeafened);
      
     
      
      // Воспроизводим звук подключения для собственного подключения
      soundService.playJoinSound();
      
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
      console.error('🎙️ Ошибка подключения к голосовому каналу:', error);
      set({ 
        error: error.message || 'Ошибка подключения к голосовому каналу',
        isConnected: false,
        currentVoiceChannelId: null,
      });
    }
  },
  
  disconnectFromVoiceChannel: () => {
    // Воспроизводим звук отключения для собственного отключения
    soundService.playLeaveSound();
    
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

  setRemoteStream: (stream) => set({ remoteStream: stream }),
  
  // P2P Call Actions
  setOutgoingP2PCall: (peer) => {
    soundService.playOutgoingCallSound();
    set({
      callType: 'p2p',
      p2pCallStatus: 'outgoing',
      p2pPeer: peer,
      error: null,
    });
  },

  setIncomingP2PCall: (peer) => {
    soundService.playIncomingCallSound();
    set({
      callType: 'p2p',
      p2pCallStatus: 'incoming',
      p2pPeer: peer,
      error: null,
    });
  },

  setP2PCallActive: () => {
    soundService.stopAllSounds();
    set((state) => ({
      ...state,
      p2pCallStatus: 'active',
    }));
  },

  clearP2PCallState: () => {
    soundService.stopAllSounds();
    soundService.playLeaveSound();
    set({
      callType: null,
      p2pCallStatus: 'idle',
      p2pPeer: null,
      remoteStream: null,
      localStream: null, // Также останавливаем локальный стрим
    });
  },

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
