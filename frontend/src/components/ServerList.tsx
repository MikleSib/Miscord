import React, { useState } from 'react';
import {
  Box,
  IconButton,
  Avatar,
  Tooltip,
  styled,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { setCurrentChannel, createChannel } from '../store/slices/channelSlice';

const ServerListContainer = styled(Box)({
  width: '72px',
  backgroundColor: '#202225',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '12px 0',
  gap: '8px',
});

const ServerButton = styled(IconButton)<{ active?: boolean }>(({ active }) => ({
  width: '48px',
  height: '48px',
  borderRadius: active ? '16px' : '50%',
  backgroundColor: active ? '#5865F2' : '#36393f',
  transition: 'all 0.2s',
  '&:hover': {
    borderRadius: '16px',
    backgroundColor: active ? '#5865F2' : '#5865F2',
  },
}));

const CreateServerButton = styled(IconButton)({
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  backgroundColor: '#36393f',
  color: '#3ba55d',
  transition: 'all 0.2s',
  '&:hover': {
    borderRadius: '16px',
    backgroundColor: '#3ba55d',
    color: 'white',
  },
});

const ServerList: React.FC = () => {
  const dispatch = useAppDispatch();
  const { channels, currentChannel } = useAppSelector(state => state.channels);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDescription, setNewChannelDescription] = useState('');

  const handleSelectChannel = (channel: any) => {
    dispatch(setCurrentChannel(channel));
  };

  const handleCreateChannel = async () => {
    if (newChannelName.trim()) {
      await dispatch(createChannel({
        name: newChannelName,
        description: newChannelDescription,
      }));
      setCreateDialogOpen(false);
      setNewChannelName('');
      setNewChannelDescription('');
    }
  };

  return (
    <>
      <ServerListContainer>
        {channels.map((channel) => (
          <Tooltip key={channel.id} title={channel.name} placement="right">
            <ServerButton
              active={currentChannel?.id === channel.id}
              onClick={() => handleSelectChannel(channel)}
            >
              <Avatar sx={{ width: 48, height: 48 }}>
                {channel.name.substring(0, 2).toUpperCase()}
              </Avatar>
            </ServerButton>
          </Tooltip>
        ))}
        
        <Divider sx={{ width: '32px', my: 1 }} />
        
        <Tooltip title="Создать сервер" placement="right">
          <CreateServerButton onClick={() => setCreateDialogOpen(true)}>
            <AddIcon />
          </CreateServerButton>
        </Tooltip>
      </ServerListContainer>

      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)}>
        <DialogTitle>Создать новый сервер</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Название сервера"
            fullWidth
            variant="outlined"
            value={newChannelName}
            onChange={(e) => setNewChannelName(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Описание (необязательно)"
            fullWidth
            multiline
            rows={3}
            variant="outlined"
            value={newChannelDescription}
            onChange={(e) => setNewChannelDescription(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Отмена</Button>
          <Button onClick={handleCreateChannel} variant="contained">
            Создать
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ServerList;