/**
 * Оптимизированный Voice Slice
 * Использует optimizedVoiceService и unifiedWebSocketService
 * для работы через единое WebSocket соединение
 */

import { create } from 'zustand';
import { VoiceUser } from '../../types';
import optimizedVoiceService from '../../services/optimizedVoiceService';
import unifiedWebSocketService from '../../services/unifiedWebSocketService';
import { useAuthStore } from '../store';
import soundService from '../../services/soundService';
import type { VoiceParticipant } from '../../services/voice/types';

export interface VoiceState {
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
  speakingUsers: Record<number, boolean>;
  
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
  setMuteDeafenState: (
    muted: boolean,
    deafened: boolean,
    wasMutedBeforeDeafen?: boolean,
  ) => void;
  setError: (error: string | null) => void;
  setSpeaking: (userId: number, isSpeaking: boolean) => void;

}

let voiceConnectionAttempt = 0;

export const useOptimizedVoiceStore = create<VoiceState>((set, get) => ({
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

  
  connectToVoiceChannel: async (channelId) => {
    let attemptId: number | null = null;
    try {
      console.log('[OptimizedVoiceSlice] 🎤 Подключение к каналу:', channelId);
      
      // Если уже подключены к каналу, сначала отключаемся
      const currentState = get();
      if (currentState.isConnecting) {
        return;
      }
      if (currentState.isConnected || currentState.currentVoiceChannelId) {
        console.log('[OptimizedVoiceSlice] Отключаемся от предыдущего канала');
        get().disconnectFromVoiceChannel();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      attemptId = ++voiceConnectionAttempt;
      
      set({
        error: null,
        isConnecting: true,
        isConnected: false,
        currentVoiceChannelId: channelId,
      });
      
      const token = useAuthStore.getState().token;
      if (!token) {
        throw new Error('Не авторизован');
      }

      // Проверяем что unified WebSocket подключен
      if (!unifiedWebSocketService.isConnected()) {
        console.log('[OptimizedVoiceSlice] Unified WebSocket не подключен, подключаемся...');
        unifiedWebSocketService.connect(token);
      }
      await unifiedWebSocketService.waitUntilReady();

      // Настраиваем обработчики событий ПЕРЕД подключением
      optimizedVoiceService.onParticipantJoined((participant) => {
        console.log('[OptimizedVoiceSlice] 👤 Участник присоединился:', participant);
        get().addParticipant({
          user_id: participant.user_id,
          username: participant.username,
          display_name: participant.display_name,
          avatar_url: participant.avatar_url,
          is_muted: participant.is_muted || false,
          is_deafened: participant.is_deafened || false,
          server_muted: participant.server_muted ?? false,
          server_deafened: participant.server_deafened ?? false,
          is_bot: participant.is_bot ?? false,
        });
      });

      optimizedVoiceService.onParticipantLeft((userId) => {
        console.log('[OptimizedVoiceSlice] 👋 Участник покинул канал:', userId);
        get().removeParticipant(userId);
      });
      
      // Обработчик изменения голосовой активности
      optimizedVoiceService.onSpeakingChanged((userId, isSpeaking) => {
        console.log('[OptimizedVoiceSlice] 🗣️ Speaking changed:', userId, isSpeaking);
        const resolvedUserId = userId ?? useAuthStore.getState().user?.id;
        if (resolvedUserId == null) return;
        get().setSpeaking(resolvedUserId, isSpeaking);
      });
      
      const applyParticipants = (participants: VoiceParticipant[]) => {
        // Преобразуем участников, убедившись что is_muted и is_deafened всегда boolean
        const normalizedParticipants: VoiceUser[] = participants.map((p) => ({
          user_id: p.user_id,
          username: p.username,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          is_muted: p.is_muted ?? false,
          is_deafened: p.is_deafened ?? false,
          server_muted: p.server_muted ?? false,
          server_deafened: p.server_deafened ?? false,
          is_bot: p.is_bot ?? false,
        }));

        // Добавляем текущего пользователя если его нет в списке
        const currentUser = useAuthStore.getState().user;
        if (currentUser) {
          const hasCurrentUser = normalizedParticipants.some(p => p.user_id === currentUser.id);
          if (!hasCurrentUser) {
            normalizedParticipants.push({
              user_id: currentUser.id,
              username: currentUser.display_name || currentUser.username,
              display_name: currentUser.display_name,
              avatar_url: currentUser.avatar_url,
              is_muted: get().isMuted,
              is_deafened: get().isDeafened,
            });
          }
        }

        get().setParticipants(normalizedParticipants);
      };

      // Обработчик получения списка участников
      optimizedVoiceService.onParticipantsReceived(applyParticipants);

      // Сигналинг подтвердил вход: показываем канал подключённым, не дожидаясь медиа
      let signalingApplied = false;
      optimizedVoiceService.onSignalingJoined((participants) => {
        if (signalingApplied) return;
        signalingApplied = true;
        applyParticipants(participants);
        set({
          currentVoiceChannelId: channelId,
          isConnected: true,
          isConnecting: false,
          error: null,
        });
        soundService.playJoinSound();
      });
      
      // Обработчик изменения статуса участников
      optimizedVoiceService.onParticipantStatusChanged((userId, status) => {
        console.log('[OptimizedVoiceSlice] 📊 Статус участника изменен:', userId, status);
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

      // Обработчик удаленных потоков
      optimizedVoiceService.onRemoteStream((userId, stream) => {
        console.log('[OptimizedVoiceSlice] 🎵 Получен удаленный поток от:', userId);
        get().setRemoteStream(stream);
      });
      
      // Подключаемся к голосовому каналу
      console.log('[OptimizedVoiceSlice] Вызываем optimizedVoiceService.joinVoiceChannel');
      await optimizedVoiceService.joinVoiceChannel(channelId);

      // A voluntary disconnect or a newer channel switch owns the state now.
      if (attemptId !== voiceConnectionAttempt) return;
      
      console.log('[OptimizedVoiceSlice] ✅ Успешно подключились к голосовому каналу');

      // Если сигналинг не успел отработать (например, мгновенный ответ) — звук здесь
      if (!signalingApplied) {
        signalingApplied = true;
        soundService.playJoinSound();
      }
      
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

    } catch (error: unknown) {
      if (attemptId === null || attemptId !== voiceConnectionAttempt) return;
      console.error('[OptimizedVoiceSlice] ❌ Ошибка подключения к голосовому каналу:', error);
      const message = error instanceof Error ? error.message : null;
      set({ 
        error: message || 'Ошибка подключения к голосовому каналу',
        isConnected: false,
        isConnecting: false,
        currentVoiceChannelId: null,
      });
    }
  },
  
  disconnectFromVoiceChannel: () => {
    console.log('[OptimizedVoiceSlice] 🔌 Отключение от голосового канала');
    
    // Воспроизводим звук отключения
    soundService.playLeaveSound();
    
    ++voiceConnectionAttempt;
    optimizedVoiceService.leaveVoiceChannel();
    
    set({
      isConnected: false,
      isConnecting: false,
      currentVoiceChannelId: null,
      participants: [],
      localStream: null,
      isMuted: false,
      isDeafened: false,
      wasMutedBeforeDeafen: false,
      error: null,
      speakingUsers: {},
    });
  },
  
  setParticipants: (participants) => {
    console.log('[OptimizedVoiceSlice] Установка участников:', participants.length);
    set({ participants });
  },
  
  addParticipant: (participant) => set((state) => {
    const exists = state.participants.find(p => p.user_id === participant.user_id);
    if (exists) {
      console.log('[OptimizedVoiceSlice] Участник уже существует:', participant.user_id);
      return state;
    }
    console.log('[OptimizedVoiceSlice] Добавление участника:', participant);
    return {
      participants: [...state.participants, participant],
    };
  }),
  
  removeParticipant: (userId) => set((state) => {
    const speakingUsers = { ...state.speakingUsers };
    delete speakingUsers[userId];
    return {
      participants: state.participants.filter(p => p.user_id !== userId),
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
  
  toggleMute: () => {
    const currentState = get();
    const newMuted = !currentState.isMuted;
    
    console.log('[OptimizedVoiceSlice] 🔇 Toggle mute:', newMuted);
    
    // Если включаем микрофон (newMuted = false) и наушники включены, то выключаем наушники
    let newDeafened = currentState.isDeafened;
    if (!newMuted && currentState.isDeafened) {
      newDeafened = false;
      optimizedVoiceService.toggleDeafen();
    }
    
    optimizedVoiceService.toggleMute();
    soundService.playMicToggleSound(newMuted);
    
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
        get().updateParticipant({
          ...existingParticipant,
          is_muted: newMuted,
          is_deafened: newDeafened,
        });
      }
    }
  },
  
  toggleDeafen: () => {
    const currentState = get();
    const newDeafened = !currentState.isDeafened;
    
    console.log('[OptimizedVoiceSlice] 🔇 Toggle deafen:', newDeafened);
    
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
    
    optimizedVoiceService.toggleDeafen();
    if (newMuted !== currentState.isMuted) {
      optimizedVoiceService.toggleMute();
      soundService.playMicToggleSound(newMuted);
    }
    
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
        get().updateParticipant({
          ...existingParticipant,
          is_muted: newMuted,
          is_deafened: newDeafened,
        });
      }
    }
  },

  setMuteDeafenState: (muted, deafened, wasMutedBeforeDeafen = muted) => {
    const currentState = get();
    if (currentState.isDeafened !== deafened) {
      void optimizedVoiceService.setDeafened(deafened);
    }
    if (currentState.isMuted !== muted) {
      void optimizedVoiceService.setMuted(muted);
    }

    set({
      isMuted: muted,
      isDeafened: deafened,
      wasMutedBeforeDeafen,
    });

    const currentUser = useAuthStore.getState().user;
    const participant = currentUser
      ? get().participants.find((item) => item.user_id === currentUser.id)
      : null;
    if (participant) {
      get().updateParticipant({
        ...participant,
        is_muted: muted,
        is_deafened: deafened,
      });
    }
  },
  
  setError: (error) => set({ error }),
  
  setSpeaking: (userId, isSpeaking) => {
    set((state) => {
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

// Экспортируем как дефолтный для обратной совместимости
export const useVoiceStore = useOptimizedVoiceStore;
export default useOptimizedVoiceStore;

unifiedWebSocketService.on('voice_moderation_update', (data: {
  server_muted?: boolean; server_deafened?: boolean; is_muted?: boolean; is_deafened?: boolean
}) => {
  const userId = useAuthStore.getState().user?.id
  if (!userId) return
  const state = useOptimizedVoiceStore.getState()
  const participant = state.participants.find((item) => item.user_id === userId)
  if (participant) state.updateParticipant({ ...participant, ...data })
})

unifiedWebSocketService.on('voice_moderation_disconnect', (data: { voice_channel_id?: number }) => {
  const state = useOptimizedVoiceStore.getState()
  if (!data.voice_channel_id || state.currentVoiceChannelId === data.voice_channel_id) {
    state.disconnectFromVoiceChannel()
  }
})

unifiedWebSocketService.on('voice_moderation_move', (data: { target_channel_id?: number }) => {
  if (data.target_channel_id) {
    void useOptimizedVoiceStore.getState().connectToVoiceChannel(data.target_channel_id)
  }
})

