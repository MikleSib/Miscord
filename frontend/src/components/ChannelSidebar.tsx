import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  styled,
  IconButton,
} from '@mui/material';
import TagIcon from '@mui/icons-material/Tag';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import AddIcon from '@mui/icons-material/Add';
import { Channel, TextChannel, VoiceChannel } from '../types';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { setCurrentTextChannel, setCurrentVoiceChannel } from '../store/slices/channelSlice';
import { connectToVoiceChannel } from '../store/slices/voiceSlice';

const SidebarContainer = styled(Box)({
  width: '240px',
  backgroundColor: '#2f3136',
  display: 'flex',
  flexDirection: 'column',
});

const ChannelHeader = styled(Box)({
  height: '48px',
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid #202225',
  cursor: 'pointer',
  '&:hover': {
    backgroundColor: '#34373c',
  },
});

const ChannelSection = styled(Box)({
  padding: '16px 8px 0',
});

const ChannelSectionHeader = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 8px',
  marginBottom: '4px',
});

const ChannelList = styled(List)({
  padding: 0,
});

const ChannelListItem = styled(ListItem)({
  padding: '1px 0',
});

const ChannelButton = styled(ListItemButton)<{ active?: boolean }>(({ active }) => ({
  borderRadius: '4px',
  padding: '6px 8px',
  backgroundColor: active ? '#393c43' : 'transparent',
  '&:hover': {
    backgroundColor: active ? '#393c43' : '#34373c',
  },
}));

interface ChannelSidebarProps {
  channel: Channel;
}

const ChannelSidebar: React.FC<ChannelSidebarProps> = ({ channel }) => {
  const dispatch = useAppDispatch();
  const { currentTextChannel, currentVoiceChannel } = useAppSelector(state => state.channels);
  const { isConnected, currentVoiceChannelId } = useAppSelector(state => state.voice);

  const handleTextChannelClick = (textChannel: TextChannel) => {
    dispatch(setCurrentTextChannel(textChannel));
  };

  const handleVoiceChannelClick = async (voiceChannel: VoiceChannel) => {
    if (!isConnected || currentVoiceChannelId !== voiceChannel.id) {
      dispatch(setCurrentVoiceChannel(voiceChannel));
      dispatch(connectToVoiceChannel(voiceChannel.id));
    }
  };

  return (
    <SidebarContainer>
      <ChannelHeader>
        <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600 }}>
          {channel.name}
        </Typography>
      </ChannelHeader>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {/* Текстовые каналы */}
        <ChannelSection>
          <ChannelSectionHeader>
            <Typography
              variant="caption"
              sx={{ color: '#96989d', fontWeight: 600, textTransform: 'uppercase' }}
            >
              Текстовые каналы
            </Typography>
            <IconButton size="small" sx={{ color: '#96989d' }}>
              <AddIcon fontSize="small" />
            </IconButton>
          </ChannelSectionHeader>
          <ChannelList>
            {channel.text_channels.map((textChannel) => (
              <ChannelListItem key={textChannel.id}>
                <ChannelButton
                  active={currentTextChannel?.id === textChannel.id}
                  onClick={() => handleTextChannelClick(textChannel)}
                >
                  <ListItemIcon sx={{ minWidth: 24 }}>
                    <TagIcon sx={{ fontSize: 20, color: '#96989d' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={textChannel.name}
                    primaryTypographyProps={{
                      variant: 'body2',
                      sx: { color: currentTextChannel?.id === textChannel.id ? '#ffffff' : '#96989d' },
                    }}
                  />
                </ChannelButton>
              </ChannelListItem>
            ))}
          </ChannelList>
        </ChannelSection>

        {/* Голосовые каналы */}
        <ChannelSection>
          <ChannelSectionHeader>
            <Typography
              variant="caption"
              sx={{ color: '#96989d', fontWeight: 600, textTransform: 'uppercase' }}
            >
              Голосовые каналы
            </Typography>
            <IconButton size="small" sx={{ color: '#96989d' }}>
              <AddIcon fontSize="small" />
            </IconButton>
          </ChannelSectionHeader>
          <ChannelList>
            {channel.voice_channels.map((voiceChannel) => (
              <ChannelListItem key={voiceChannel.id}>
                <ChannelButton
                  active={currentVoiceChannelId === voiceChannel.id}
                  onClick={() => handleVoiceChannelClick(voiceChannel)}
                >
                  <ListItemIcon sx={{ minWidth: 24 }}>
                    <VolumeUpIcon sx={{ fontSize: 20, color: '#96989d' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={voiceChannel.name}
                    primaryTypographyProps={{
                      variant: 'body2',
                      sx: { color: currentVoiceChannelId === voiceChannel.id ? '#ffffff' : '#96989d' },
                    }}
                  />
                </ChannelButton>
              </ChannelListItem>
            ))}
          </ChannelList>
        </ChannelSection>
      </Box>
    </SidebarContainer>
  );
};

export default ChannelSidebar;