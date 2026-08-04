'use client'

import { Box, Typography, Avatar, IconButton } from '@mui/material';
import { X, Monitor, MonitorOff, UserPlus, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { useAuthStore } from '../store/store';
import { useStore } from '../lib/store';
import { UserAvatar } from './ui/user-avatar';
import { User } from '../types';
import { useEffect, useRef, useState } from 'react';
import p2pVoiceService from '../services/p2pVoiceService';

interface VoiceOverlayProps {
  onHangUp?: () => void;
  participantsList?: any[];
  channelName?: string;
  serverName?: string;
}

import { SpeakingAvatar } from './SpeakingAvatar'

export function VoiceOverlay({ onHangUp, participantsList, channelName, serverName }: VoiceOverlayProps) {
  const {
    isConnected: isConnectedStore,
    participants: participantsStore,
    currentVoiceChannelId,
    disconnectFromVoiceChannel: disconnectFromVoiceChannelStore,
    speakingUsers,
    isMuted: storeIsMuted,
    isDeafened: storeIsDeafened,
    toggleMute: storeToggleMute,
    toggleDeafen: storeToggleDeafen
  } = useVoiceStore();
  const { user } = useAuthStore();
  const { currentServer } = useStore();

  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  // Обработка входящего аудио потока для P2P звонков
  useEffect(() => {
    const handleRemoteStream = (stream: MediaStream) => {
      console.log('[VoiceOverlay] Received remote stream:', stream);
      setRemoteStream(stream);
      
      // Проверяем наличие видео треков
      const hasVideo = stream.getVideoTracks().length > 0;
      setHasRemoteVideo(hasVideo);
      
      // Обрабатываем аудио
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.volume = 1.0;
        remoteAudioRef.current.play().catch(e => console.error('Error playing remote audio:', e));
      }
      
      // Обрабатываем видео (screen share)
      if (hasVideo && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(e => console.error('Error playing remote video:', e));
      }
    };

    const handleMuteChanged = (muted: boolean) => {
      setIsMuted(muted);
    };

    const handleDeafenChanged = (deafened: boolean) => {
      setIsDeafened(deafened);
    };

    const handleScreenShareChanged = (sharing: boolean) => {
      setIsScreenSharing(sharing);
    };

    p2pVoiceService.on('remote_stream_received', handleRemoteStream);
    p2pVoiceService.on('mute_changed', handleMuteChanged);
    p2pVoiceService.on('deafen_changed', handleDeafenChanged);
    p2pVoiceService.on('screen_share_changed', handleScreenShareChanged);

    // Синхронизация начального состояния
    setIsMuted(p2pVoiceService.getIsMuted());
    setIsDeafened(p2pVoiceService.getIsDeafened());
    setIsScreenSharing(p2pVoiceService.getIsScreenSharing());

    return () => {
      p2pVoiceService.off('remote_stream_received', handleRemoteStream);
      p2pVoiceService.off('mute_changed', handleMuteChanged);
      p2pVoiceService.off('deafen_changed', handleDeafenChanged);
      p2pVoiceService.off('screen_share_changed', handleScreenShareChanged);
    };
  }, []);

  // useEffect для применения состояния isDeafened к audio элементу
  useEffect(() => {
    if (remoteAudioRef.current) {
      // Когда включен deafen, отключаем звук
      remoteAudioRef.current.muted = isDeafened;
    }
  }, [isDeafened]);

  // Функции управления микрофоном и наушниками
  const toggleMute = () => {
    if (onHangUp) {
      // P2P звонок
      p2pVoiceService.toggleMute();
    } else {
      // Обычный голосовой канал
      storeToggleMute();
    }
  };

  const toggleDeafen = () => {
    if (onHangUp) {
      // P2P звонок
      p2pVoiceService.toggleDeafen();
    } else {
      // Обычный голосовой канал
      storeToggleDeafen();
    }
  };

  const toggleScreenShare = async () => {
    if (onHangUp) {
      // P2P звонок - только для P2P доступна screen share пока
      if (isScreenSharing) {
        p2pVoiceService.stopScreenShare();
      } else {
        await p2pVoiceService.startScreenShare();
      }
    }
  };

  const isConnected = onHangUp ? true : isConnectedStore;
  const disconnectFromVoiceChannel = onHangUp ? onHangUp : disconnectFromVoiceChannelStore;
  const allParticipants = participantsList
    ? participantsList
    : [
        ...(user
          ? [
              {
                user_id: user.id,
                username: user.username,
                display_name: user.display_name,
                avatar_url: user.avatar_url,
                is_muted: isMuted,
                is_deafened: isDeafened,
              },
            ]
          : []),
        ...participantsStore.filter((p) => p.user_id !== user?.id),
      ];
  
  const currentVoiceChannel = currentServer?.channels.find(
    c => c.type === 'voice' && c.id === currentVoiceChannelId
  );

  if (!isConnected || (!currentVoiceChannelId && !onHangUp)) {
    return null;
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 16,
        right: 16,
        backgroundColor: 'rgba(54, 57, 63, 0.95)',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        minWidth: 200,
        maxWidth: 300,
        zIndex: 1000,
        backdropFilter: 'blur(10px)',
      }}
    >
      {/* Заголовок */}
      <Box
        sx={{
          padding: '12px 16px 8px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box>
          <Typography variant="body2" sx={{ color: '#f5f5f5', fontWeight: 600 }}>
            {channelName || currentVoiceChannel?.name || 'Голосовой звонок'}
          </Typography>
          <Typography variant="caption" sx={{ color: '#7d7e87' }}>
            {serverName || currentServer?.name}
          </Typography>
        </Box>
        <IconButton 
          size="small" 
          onClick={disconnectFromVoiceChannel}
          sx={{ color: '#cdcdcf', '&:hover': { color: '#da3e44' } }}
        >
          <X size={16} />
        </IconButton>
      </Box>

      {/* Участники */}
      <Box>
        {allParticipants.map((participant) => {
          const isSpeaking = Boolean(speakingUsers[participant.user_id]);
          
          return (
            <Box
              key={participant.user_id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                padding: '6px 16px',
                backgroundColor: isSpeaking ? 'rgba(0, 255, 136, 0.1)' : 'transparent',
                '&:hover': {
                  backgroundColor: isSpeaking ? 'rgba(0, 255, 136, 0.2)' : 'rgba(79, 84, 92, 0.16)',
                },
                transition: 'background-color 0.2s ease-in-out',
              }}
            >
              <SpeakingAvatar 
                user={participant} 
                isSpeaking={isSpeaking}
                size={24}
              />
              <Typography
                variant="body2"
                sx={{
                  color: isSpeaking ? '#23a55a' : '#f5f5f5',
                  flex: 1,
                  fontSize: '14px',
                  fontWeight: isSpeaking ? 600 : 400,
                  transition: 'all 0.2s ease-in-out',
                }}
              >
                {participant.display_name || participant.username}
                {participant.user_id === user?.id && (
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ color: '#7d7e87', ml: 1 }}
                  >
                    (Вы)
                  </Typography>
                )}
              </Typography>
              
              {/* Иконки статуса */}
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {/* Иконка микрофона */}
                {participant.is_muted ? (
                  <MicOff 
                    size={14} 
                    style={{ 
                      color: '#da3e44',
                      opacity: 0.8 
                    }} 
                  />
                ) : (
                  <Mic 
                    size={14} 
                    style={{ 
                      color: '#23a55a',
                      opacity: 0.8 
                    }} 
                  />
                )}
                
                {/* Иконка наушников */}
                {participant.is_deafened ? (
                  <VolumeX 
                    size={14} 
                    style={{ 
                      color: '#da3e44',
                      opacity: 0.8 
                    }} 
                  />
                ) : (
                  <Volume2 
                    size={14} 
                    style={{ 
                      color: '#23a55a',
                      opacity: 0.8 
                    }} 
                  />
                )}
              </Box>
            </Box>
          );
        })}
        
        {allParticipants.length === 0 && (
          <Box sx={{ padding: '16px', textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: '#7d7e87' }}>
              Нет участников
            </Typography>
          </Box>
        )}
      </Box>

      {/* Управление микрофоном и наушниками */}
      <Box
        sx={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          gap: 1,
          justifyContent: 'center',
        }}
      >
        {/* Кнопка микрофона */}
        <IconButton 
          size="small" 
          onClick={toggleMute}
          sx={{ 
            color: isMuted ? '#da3e44' : '#23a55a',
            backgroundColor: isMuted ? 'rgba(240, 71, 71, 0.1)' : 'rgba(67, 181, 129, 0.1)',
            '&:hover': { 
              backgroundColor: isMuted ? 'rgba(240, 71, 71, 0.2)' : 'rgba(67, 181, 129, 0.2)',
            },
            border: `1px solid ${isMuted ? '#da3e44' : '#23a55a'}`,
          }}
        >
          {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </IconButton>
        
        {/* Кнопка наушников */}
        <IconButton 
          size="small" 
          onClick={toggleDeafen}
          sx={{ 
            color: isDeafened ? '#da3e44' : '#23a55a',
            backgroundColor: isDeafened ? 'rgba(240, 71, 71, 0.1)' : 'rgba(67, 181, 129, 0.1)',
            '&:hover': { 
              backgroundColor: isDeafened ? 'rgba(240, 71, 71, 0.2)' : 'rgba(67, 181, 129, 0.2)',
            },
            border: `1px solid ${isDeafened ? '#da3e44' : '#23a55a'}`,
          }}
        >
          {isDeafened ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </IconButton>
        
        {/* Кнопка демонстрации экрана */}
        <IconButton
          size="small"
          onClick={toggleScreenShare}
          sx={{ 
            color: isScreenSharing ? '#23a55a' : '#cdcdcf',
            backgroundColor: isScreenSharing ? 'rgba(67, 181, 129, 0.1)' : 'transparent',
            '&:hover': { 
              color: isScreenSharing ? '#23a55a' : '#f5f5f5',
              backgroundColor: isScreenSharing ? 'rgba(67, 181, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)',
            },
            border: isScreenSharing ? '1px solid #23a55a' : 'none',
          }}
          title={isScreenSharing ? "Остановить демонстрацию экрана" : "Демонстрация экрана"}
        >
          {isScreenSharing ? <MonitorOff size={16} /> : <Monitor size={16} />}
        </IconButton>
      </Box>

      {/* Скрытый audio элемент для воспроизведения входящего аудио */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        style={{ display: 'none' }}
      />

      {/* Video элемент для отображения screen share от собеседника */}
      {hasRemoteVideo && (
        <Box
          sx={{
            position: 'fixed',
            top: 80,
            right: 20,
            width: 400,
            maxWidth: 'calc(100vw - 40px)',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            border: '2px solid #23a55a',
            backgroundColor: '#000',
            zIndex: 9999,
          }}
        >
          <Box
            sx={{
              padding: '8px 12px',
              backgroundColor: 'rgba(67, 181, 129, 0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'white' }}>
              Демонстрация экрана
            </Typography>
            <IconButton
              size="small"
              onClick={() => setHasRemoteVideo(false)}
              sx={{ color: 'white', padding: '2px' }}
            >
              <X size={16} />
            </IconButton>
          </Box>
          <video
            ref={remoteVideoRef}
            autoPlay
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
            }}
          />
        </Box>
      )}
    </Box>
  );
}
