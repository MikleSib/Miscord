import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Avatar,
  IconButton,
  styled,
  List,
  ListItem,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { disconnectFromVoiceChannel } from '../store/slices/voiceSlice';

const OverlayContainer = styled(Paper)({
  position: 'fixed',
  bottom: '80px',
  right: '20px',
  width: '300px',
  backgroundColor: '#2f3136',
  borderRadius: '8px',
  overflow: 'hidden',
  boxShadow: '0 2px 10px 0 rgba(0,0,0,.2)',
});

const OverlayHeader = styled(Box)({
  padding: '12px 16px',
  backgroundColor: '#202225',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
});

const ParticipantList = styled(List)({
  padding: '8px',
  maxHeight: '300px',
  overflowY: 'auto',
});

const ParticipantItem = styled(ListItem)({
  padding: '8px',
  borderRadius: '4px',
  '&:hover': {
    backgroundColor: '#393c43',
  },
});

const VoiceOverlay: React.FC = () => {
  const dispatch = useAppDispatch();
  const { currentVoiceChannel } = useAppSelector((state) => state.channels);
  const { participants, isMuted, isDeafened } = useAppSelector((state) => state.voice);
  const { user } = useAppSelector((state) => state.auth);

  const handleDisconnect = () => {
    dispatch(disconnectFromVoiceChannel());
  };

  if (!currentVoiceChannel || !user) return null;

  // Добавляем текущего пользователя в список участников
  const allParticipants = [
    {
      user_id: user.id,
      username: user.username,
      is_muted: isMuted,
      is_deafened: isDeafened,
    },
    ...participants.filter(p => p.user_id !== user.id),
  ];

  return (
    <OverlayContainer elevation={3}>
      <OverlayHeader>
        <Typography variant="subtitle1" sx={{ color: '#ffffff', fontWeight: 600 }}>
          {currentVoiceChannel.name}
        </Typography>
        <IconButton size="small" onClick={handleDisconnect} sx={{ color: '#b9bbbe' }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </OverlayHeader>

      <ParticipantList>
        {allParticipants.map((participant) => (
          <ParticipantItem key={participant.user_id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
              <Avatar sx={{ width: 32, height: 32 }}>
                {participant.username[0].toUpperCase()}
              </Avatar>
              <Typography
                variant="body2"
                sx={{
                  flex: 1,
                  color: participant.is_deafened ? '#f04747' : '#dcddde',
                  textDecoration: participant.is_deafened ? 'line-through' : 'none',
                }}
              >
                {participant.username}
                {participant.user_id === user.id && ' (Вы)'}
              </Typography>
              {participant.is_muted && (
                <MicOffIcon sx={{ fontSize: 16, color: '#f04747' }} />
              )}
            </Box>
          </ParticipantItem>
        ))}
      </ParticipantList>
    </OverlayContainer>
  );
};

export default VoiceOverlay;