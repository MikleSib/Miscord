import React from 'react';
import {
  Box,
  Avatar,
  Typography,
  IconButton,
  styled,
  Tooltip,
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import HeadsetIcon from '@mui/icons-material/Headset';
import HeadsetOffIcon from '@mui/icons-material/HeadsetOff';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { logout } from '../store/slices/authSlice';
import { toggleMute, toggleDeafen, disconnectFromVoiceChannel } from '../store/slices/voiceSlice';
import { useNavigate } from 'react-router-dom';

const UserPanelContainer = styled(Box)({
  height: '52px',
  backgroundColor: '#292b2f',
  padding: '0 8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
});

const UserInfo = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  minWidth: 0,
});

const UserControls = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
});

const ControlButton = styled(IconButton)({
  color: '#b9bbbe',
  padding: '4px',
  '&:hover': {
    color: '#dcddde',
    backgroundColor: '#383a40',
  },
});

const UserPanel: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user } = useAppSelector((state) => state.auth);
  const { isConnected, isMuted, isDeafened } = useAppSelector((state) => state.voice);

  const handleLogout = () => {
    if (isConnected) {
      dispatch(disconnectFromVoiceChannel());
    }
    dispatch(logout());
    navigate('/login');
  };

  const handleToggleMute = () => {
    if (isConnected) {
      dispatch(toggleMute());
    }
  };

  const handleToggleDeafen = () => {
    if (isConnected) {
      dispatch(toggleDeafen());
    }
  };

  if (!user) return null;

  return (
    <UserPanelContainer>
      <UserInfo>
        <Avatar sx={{ width: 32, height: 32 }}>
          {user.username[0].toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              color: '#ffffff',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.username}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: '#b9bbbe',
              fontSize: '11px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            #{user.id.toString().padStart(4, '0')}
          </Typography>
        </Box>
      </UserInfo>

      <UserControls>
        <Tooltip title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}>
          <ControlButton
            onClick={handleToggleMute}
            disabled={!isConnected}
            sx={{ color: isMuted ? '#f04747' : '#b9bbbe' }}
          >
            {isMuted ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
          </ControlButton>
        </Tooltip>

        <Tooltip title={isDeafened ? 'Включить звук' : 'Выключить звук'}>
          <ControlButton
            onClick={handleToggleDeafen}
            disabled={!isConnected}
            sx={{ color: isDeafened ? '#f04747' : '#b9bbbe' }}
          >
            {isDeafened ? <HeadsetOffIcon fontSize="small" /> : <HeadsetIcon fontSize="small" />}
          </ControlButton>
        </Tooltip>

        <Tooltip title="Настройки">
          <ControlButton>
            <SettingsIcon fontSize="small" />
          </ControlButton>
        </Tooltip>

        <Tooltip title="Выйти">
          <ControlButton onClick={handleLogout}>
            <LogoutIcon fontSize="small" />
          </ControlButton>
        </Tooltip>
      </UserControls>
    </UserPanelContainer>
  );
};

export default UserPanel;