'use client'

import React from 'react';
import { Avatar, Box, Typography, IconButton } from '@mui/material';
import { Settings, LogOut } from 'lucide-react';
import { useStore } from '../lib/store';

export function UserPanel() {
  const { user, logout } = useStore();

  if (!user) {
    return null;
  }

  return (
    <Box
      sx={{
        height: '52px',
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Avatar sx={{ width: 32, height: 32, fontSize: '14px' }}>
          {user.avatar ? (
            <img src={user.avatar} alt={user.username} />
          ) : (
            user.username[0].toUpperCase()
          )}
        </Avatar>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, color: '#dcddde' }}>
            {user.username}
          </Typography>
          <Typography variant="caption" sx={{ color: '#72767d' }}>
            Онлайн
          </Typography>
        </Box>
      </Box>
      
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <IconButton size="small" sx={{ color: '#b9bbbe' }}>
          <Settings size={16} />
        </IconButton>
        <IconButton size="small" onClick={logout} sx={{ color: '#b9bbbe' }}>
          <LogOut size={16} />
        </IconButton>
      </Box>
    </Box>
  );
}