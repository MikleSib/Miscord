'use client'

import { Box, Typography, Avatar, IconButton } from '@mui/material';
import { X, Monitor, UserPlus, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { useAuthStore } from '../store/store';
import { useStore } from '../lib/store';

// Компонент для аватарки с анимацией при разговоре
interface SpeakingAvatarProps {
  username: string;
  isSpeaking: boolean;
  size?: number;
}

function SpeakingAvatar({ username, isSpeaking, size = 24 }: SpeakingAvatarProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {/* Анимированная обводка */}
      {isSpeaking && (
        <Box
          sx={{
            position: 'absolute',
            top: -3,
            left: -3,
            width: size + 6,
            height: size + 6,
            borderRadius: '50%',
            background: 'linear-gradient(45deg, #00ff88, #00cc6a)',
            animation: 'speaking-pulse 1.5s ease-in-out infinite',
            '@keyframes speaking-pulse': {
              '0%': {
                transform: 'scale(1)',
                opacity: 0.8,
              },
              '50%': {
                transform: 'scale(1.1)',
                opacity: 1,
              },
              '100%': {
                transform: 'scale(1)',
                opacity: 0.8,
              },
            },
          }}
        />
      )}
      
      {/* Основная аватарка */}
      <Avatar 
        sx={{ 
          width: size, 
          height: size, 
          fontSize: `${size * 0.4}px`,
          backgroundColor: isSpeaking ? '#00ff88' : '#5865f2',
          color: 'white',
          fontWeight: 600,
          zIndex: 1,
          position: 'relative',
          border: isSpeaking ? '2px solid #00ff88' : '2px solid transparent',
          transition: 'all 0.2s ease-in-out',
        }}
      >
        {username[0].toUpperCase()}
      </Avatar>
    </Box>
  );
}

export function VoiceOverlay() {
  const { 
    isConnected, 
    participants, 
    currentVoiceChannelId,
    disconnectFromVoiceChannel,
    speakingUsers,
    isMuted,
    isDeafened,
    toggleMute,
    toggleDeafen
  } = useVoiceStore();
  const { user } = useAuthStore();
  const { currentServer } = useStore();

  if (!isConnected || !currentVoiceChannelId) {
    return null;
  }

  // Находим текущий голосовой канал
  const currentVoiceChannel = currentServer?.channels.find(
    c => c.type === 'voice' && c.id === currentVoiceChannelId
  );

  // Все участники включая текущего пользователя
  const allParticipants = [
    ...(user ? [{
      user_id: user.id,
      username: user.username,
      is_muted: isMuted,
      is_deafened: isDeafened,
    }] : []),
    ...participants.filter(p => p.user_id !== user?.id),
  ];

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
          <Typography variant="body2" sx={{ color: '#dcddde', fontWeight: 600 }}>
            {currentVoiceChannel?.name || 'Голосовой канал'}
          </Typography>
          <Typography variant="caption" sx={{ color: '#72767d' }}>
            {currentServer?.name}
          </Typography>
        </Box>
        <IconButton 
          size="small" 
          onClick={disconnectFromVoiceChannel}
          sx={{ color: '#b9bbbe', '&:hover': { color: '#f04747' } }}
        >
          <X size={16} />
        </IconButton>
      </Box>

      {/* Участники */}
      <Box>
        {allParticipants.map((participant) => {
          const isSpeaking = speakingUsers.has(participant.user_id);
          
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
                username={participant.username} 
                isSpeaking={isSpeaking}
                size={24}
              />
              <Typography
                variant="body2"
                sx={{
                  color: isSpeaking ? '#00ff88' : '#dcddde',
                  flex: 1,
                  fontSize: '14px',
                  fontWeight: isSpeaking ? 600 : 400,
                  transition: 'all 0.2s ease-in-out',
                }}
              >
                {participant.username}
                {participant.user_id === user?.id && (
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{ color: '#72767d', ml: 1 }}
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
                      color: '#f04747',
                      opacity: 0.8 
                    }} 
                  />
                ) : (
                  <Mic 
                    size={14} 
                    style={{ 
                      color: '#43b581',
                      opacity: 0.8 
                    }} 
                  />
                )}
                
                {/* Иконка наушников */}
                {participant.is_deafened ? (
                  <VolumeX 
                    size={14} 
                    style={{ 
                      color: '#f04747',
                      opacity: 0.8 
                    }} 
                  />
                ) : (
                  <Volume2 
                    size={14} 
                    style={{ 
                      color: '#43b581',
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
            <Typography variant="body2" sx={{ color: '#72767d' }}>
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
            color: isMuted ? '#f04747' : '#43b581',
            backgroundColor: isMuted ? 'rgba(240, 71, 71, 0.1)' : 'rgba(67, 181, 129, 0.1)',
            '&:hover': { 
              backgroundColor: isMuted ? 'rgba(240, 71, 71, 0.2)' : 'rgba(67, 181, 129, 0.2)',
            },
            border: `1px solid ${isMuted ? '#f04747' : '#43b581'}`,
          }}
        >
          {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </IconButton>
        
        {/* Кнопка наушников */}
        <IconButton 
          size="small" 
          onClick={toggleDeafen}
          sx={{ 
            color: isDeafened ? '#f04747' : '#43b581',
            backgroundColor: isDeafened ? 'rgba(240, 71, 71, 0.1)' : 'rgba(67, 181, 129, 0.1)',
            '&:hover': { 
              backgroundColor: isDeafened ? 'rgba(240, 71, 71, 0.2)' : 'rgba(67, 181, 129, 0.2)',
            },
            border: `1px solid ${isDeafened ? '#f04747' : '#43b581'}`,
          }}
        >
          {isDeafened ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </IconButton>
        
        {/* Дополнительные действия */}
        <IconButton 
          size="small" 
          sx={{ color: '#b9bbbe', '&:hover': { color: '#dcddde' } }}
        >
          <Monitor size={16} />
        </IconButton>
      </Box>
    </Box>
  );
}