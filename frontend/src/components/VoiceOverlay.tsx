'use client'

import { Box, Typography, Avatar, IconButton } from '@mui/material';
import { X, Monitor, UserPlus } from 'lucide-react';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { useAuthStore } from '../store/store';
import { useStore } from '../lib/store';

export function VoiceOverlay() {
  const { 
    isConnected, 
    participants, 
    currentVoiceChannelId,
    disconnectFromVoiceChannel 
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
      is_muted: false,
      is_deafened: false,
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
      <Box sx={{ padding: '8px 0', maxHeight: 300, overflowY: 'auto' }}>
        {allParticipants.map((participant) => (
          <Box
            key={participant.user_id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: '6px 16px',
              '&:hover': {
                backgroundColor: 'rgba(79, 84, 92, 0.16)',
              },
            }}
          >
            <Avatar sx={{ width: 24, height: 24, fontSize: '12px' }}>
              {participant.username[0].toUpperCase()}
            </Avatar>
            <Typography
              variant="body2"
              sx={{
                color: '#dcddde',
                flex: 1,
                fontSize: '14px',
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
          </Box>
        ))}
        
        {allParticipants.length === 0 && (
          <Box sx={{ padding: '16px', textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: '#72767d' }}>
              Нет участников
            </Typography>
          </Box>
        )}
      </Box>

      {/* Дополнительные действия */}
      <Box
        sx={{
          padding: '8px 16px 12px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          gap: 1,
        }}
      >
        <IconButton
          size="small"
          sx={{
            color: '#b9bbbe',
            backgroundColor: 'rgba(79, 84, 92, 0.4)',
            borderRadius: '4px',
            width: 32,
            height: 32,
            '&:hover': {
              backgroundColor: 'rgba(79, 84, 92, 0.6)',
            }
          }}
          title="Демонстрация экрана"
        >
          <Monitor size={16} />
        </IconButton>
        
        <IconButton
          size="small"
          sx={{
            color: '#b9bbbe',
            backgroundColor: 'rgba(79, 84, 92, 0.4)',
            borderRadius: '4px',
            width: 32,
            height: 32,
            '&:hover': {
              backgroundColor: 'rgba(79, 84, 92, 0.6)',
            }
          }}
          title="Пригласить пользователя"
        >
          <UserPlus size={16} />
        </IconButton>
      </Box>
    </Box>
  );
}