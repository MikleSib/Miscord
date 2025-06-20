import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  TextField,
  Typography,
  styled,
  Paper,
  Avatar,
  CircularProgress,
} from '@mui/material';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { addMessage } from '../store/slices/chatSlice';
import websocketService from '../services/websocketService';
import authService from '../services/authService';

const ChatContainer = styled(Box)({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: '#36393f',
});

const ChatHeader = styled(Box)({
  height: '48px',
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
  borderBottom: '1px solid #202225',
  backgroundColor: '#36393f',
});

const MessagesContainer = styled(Box)({
  flex: 1,
  overflowY: 'auto',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
});

const MessageBox = styled(Paper)({
  padding: '8px 16px',
  backgroundColor: 'transparent',
  boxShadow: 'none',
  display: 'flex',
  gap: '12px',
  '&:hover': {
    backgroundColor: 'rgba(4, 4, 5, 0.07)',
  },
});

const MessageInput = styled(TextField)({
  margin: '16px',
  '& .MuiOutlinedInput-root': {
    backgroundColor: '#40444b',
    '& fieldset': {
      borderColor: 'transparent',
    },
    '&:hover fieldset': {
      borderColor: 'transparent',
    },
    '&.Mui-focused fieldset': {
      borderColor: 'transparent',
    },
  },
});

const ChatArea: React.FC = () => {
  const dispatch = useAppDispatch();
  const { currentChannel, currentTextChannel } = useAppSelector(state => state.channels);
  const messages = useAppSelector(state => 
    currentTextChannel ? state.chat.messages[currentTextChannel.id] || [] : []
  );
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (currentChannel) {
      const token = authService.getToken();
      if (token) {
        websocketService.connect(currentChannel.id, token);
        
        websocketService.on('new_message', (data) => {
          dispatch(addMessage(data.message));
        });
      }
    }

    return () => {
      websocketService.disconnect();
    };
  }, [currentChannel, dispatch]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && currentTextChannel) {
      websocketService.sendMessage(currentTextChannel.id, inputValue);
      setInputValue('');
    }
  };

  if (!currentTextChannel) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <ChatContainer>
      <ChatHeader>
        <Typography variant="h6" sx={{ color: '#dcddde' }}>
          # {currentTextChannel.name}
        </Typography>
      </ChatHeader>

      <MessagesContainer>
        {messages.map((message) => (
          <MessageBox key={message.id}>
            <Avatar sx={{ width: 40, height: 40 }}>
              {message.author.username[0].toUpperCase()}
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, color: '#ffffff' }}>
                  {message.author.username}
                </Typography>
                <Typography variant="caption" sx={{ color: '#72767d' }}>
                  {new Date(message.created_at).toLocaleString()}
                </Typography>
              </Box>
              <Typography variant="body1" sx={{ color: '#dcddde' }}>
                {message.content}
              </Typography>
            </Box>
          </MessageBox>
        ))}
        <div ref={messagesEndRef} />
      </MessagesContainer>

      <Box component="form" onSubmit={handleSendMessage}>
        <MessageInput
          fullWidth
          placeholder={`Написать в #${currentTextChannel.name}`}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          variant="outlined"
          autoComplete="off"
        />
      </Box>
    </ChatContainer>
  );
};

export default ChatArea;