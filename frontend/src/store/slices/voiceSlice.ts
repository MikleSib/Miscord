import { create } from 'zustand';
import { VoiceUser, User } from '../../types';
import voiceService from '../../services/voiceService';
import channelService from '../../services/channelService';
import { useAuthStore } from '../store';
import soundService from '../../services/soundService';

type CallType = 'channel' | 'p2p' | null;
type P2PCallStatus = 'idle' | 'outgoing' | 'incoming' | 'active';

interface VoiceState {
  isConnected: boolean;
  isConnecting: boolean;
  currentVoiceChannelId: number | null;
  participants: VoiceUser[];
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isDeafened: boolean;
  wasMutedBeforeDeafen: boolean;
  error: string | null;
  /** userId -> говорит ли сейчас (объект надёжнее Set для перерисовки React) */
  speakingUsers: Record<number, boolean>;
  
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
  isConnecting: false,
  currentVoiceChannelId: null,
  participants: [],
  localStream: null,
  remoteStream: null,
  isMuted: false,
  isDeafened: false,
  wasMutedBeforeDeafen: false,
  error: null,
  speakingUsers: {},

  // P2P Call State
  callType: null,
  p2pCallStatus: 'idle',
  p2pPeer: null,
  
  connectToVoiceChannel: async (channelId) => {
    try {
      
      // Если уже подключены к каналу, сначала отключаемся
      const currentState = get();
      if (currentState.isConnecting && currentState.currentVoiceChannelId === channelId) {
        return;
      }
      if (currentState.isConnected || currentState.currentVoiceChannelId) {
        get().disconnectFromVoiceChannel();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      set({
        error: null,
        isConnecting: true,
        isConnected: false,
        currentVoiceChannelId: channelId,
      });

      // Сразу показываем тех, кто уже в канале (не ждём микрофон/WebRTC)
      try {
        const existingMembers = await channelService.getVoiceChannelMembers(channelId);
        const currentUser = useAuthStore.getState().user;
        const seeded: VoiceUser[] = existingMembers.map((member: any) => ({
          user_id: member.user_id ?? member.id,
          username: member.username || member.display_name || 'User',
          display_name: member.display_name,
          avatar_url: member.avatar_url,
          is_muted: Boolean(member.is_muted),
          is_deafened: Boolean(member.is_deafened),
        }));
        if (
          currentUser &&
          !seeded.some((participant) => participant.user_id === currentUser.id)
        ) {
          seeded.unshift({
            user_id: currentUser.id,
            username: currentUser.display_name || currentUser.username,
            display_name: currentUser.display_name,
            avatar_url: currentUser.avatar_url,
            is_muted: get().isMuted,
            is_deafened: get().isDeafened,
          });
        }
        // Не затираем, если WebSocket уже прислал более свежий список
        if (get().currentVoiceChannelId === channelId && get().participants.length === 0) {
          set({ participants: seeded });
        } else if (get().currentVoiceChannelId === channelId) {
          const known = new Map(get().participants.map((p) => [p.user_id, p]));
          for (const member of seeded) {
            if (!known.has(member.user_id)) {
              known.set(member.user_id, member);
            }
          }
          set({ participants: Array.from(known.values()) });
        }
      } catch (seedError) {
        console.warn('[VoiceSlice] Не удалось заранее загрузить участников канала:', seedError);
      }
      
      const token = useAuthStore.getState().token;
      if (!token) {
        throw new Error('Не авторизован');
      }


      // Настраиваем обработчики событий
      voiceService.onConnectionStateChange((state, message) => {
        if (state === 'connected') {
          set({ isConnected: true, isConnecting: false, error: null });
          return;
        }

        set({
          isConnected: false,
          isConnecting: false,
          currentVoiceChannelId: null,
          participants: [],
          speakingUsers: {},
          error: message || (state === 'error' ? 'Ошибка голосового соединения' : null),
        });
      });
      
      // Обработчик присоединения участника
      voiceService.onParticipantJoin((participant) => {
        console.log('[VoiceSlice] 👤 Участник присоединился:', participant);
        get().addParticipant({
          user_id: participant.user_id,
          username: participant.username,
          display_name: participant.display_name,
          avatar_url: participant.avatar_url,
          is_muted: participant.is_muted || false,
          is_deafened: participant.is_deafened || false,
        });
      });
      
      // Обработчик выхода участника
      voiceService.onParticipantLeave((userId) => {
        console.log('[VoiceSlice] 👋 Участник покинул канал:', userId);
        get().removeParticipant(userId);
      });
      
      // Обработчик изменения голосовой активности
      voiceService.onSpeakingChange((userId, isSpeaking) => {
       
        get().setSpeaking(userId, isSpeaking);
      });
      
      // Обработчик получения списка участников
      voiceService.onParticipantsReceived((participants) => {
        const nextParticipants = [...participants];
        const currentUser = useAuthStore.getState().user;
        if (currentUser && !nextParticipants.some((participant: any) => participant.user_id === currentUser.id)) {
          nextParticipants.push({
            user_id: currentUser.id,
            username: currentUser.display_name || currentUser.username,
            display_name: currentUser.display_name,
            avatar_url: currentUser.avatar_url,
            is_muted: get().isMuted,
            is_deafened: get().isDeafened,
          });
        }
        get().setParticipants(nextParticipants);
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
        isConnecting: false,
        error: null,
      });


    } catch (error: any) {
      console.error('🎙️ Ошибка подключения к голосовому каналу:', error);
      set({ 
        error: error.message || 'Ошибка подключения к голосовому каналу',
        isConnected: false,
        isConnecting: false,
        currentVoiceChannelId: null,
      });
      throw error;
    }
  },
  
  disconnectFromVoiceChannel: () => {
    const wasInVoice = get().isConnected || get().isConnecting || get().currentVoiceChannelId !== null;
    if (wasInVoice) {
      soundService.playLeaveSound();
    }
    
    voiceService.disconnect();
    set({
      isConnected: false,
      isConnecting: false,
      currentVoiceChannelId: null,
      participants: [],
      localStream: null,
      speakingUsers: {},
      error: null,
    });
  },
  
  setParticipants: (participants) => set({ participants }),
  
  addParticipant: (participant) => {
    console.log('[VoiceSlice] addParticipant вызван:', participant);
    const exists = get().participants.find(p => p.user_id === participant.user_id);
    if (exists) {
      console.log('[VoiceSlice] Участник уже существует, не добавляем');
    } else {
      console.log('[VoiceSlice] Добавляем нового участника в список');
    }
    return set((state) => ({
      participants: state.participants.find(p => p.user_id === participant.user_id)
        ? state.participants
        : [...state.participants, participant],
    }));
  },
  
  removeParticipant: (userId) => set((state) => {
    const speakingUsers = { ...state.speakingUsers };
    delete speakingUsers[userId];
    return {
      participants: state.participants.filter((p) => p.user_id !== userId),
      speakingUsers,
    };
  }),
  
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
      if (Boolean(state.speakingUsers[userId]) === isSpeaking) {
        return state;
      }
      const speakingUsers = { ...state.speakingUsers };
      if (isSpeaking) {
        speakingUsers[userId] = true;
      } else {
        delete speakingUsers[userId];
      }
      return { speakingUsers };
    });
  },
}));
