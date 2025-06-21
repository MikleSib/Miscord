'use client'

import React, { useState, useEffect } from 'react';
import { Avatar, Box, Typography, IconButton } from '@mui/material';
import { Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '../store/store';
import { useRouter } from 'next/navigation';

export function UserPanel() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!user || !isMounted) {
    return null;
  }

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <Box
      sx={{
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        height: '52px',
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
        <IconButton size="small" onClick={handleLogout} sx={{ color: '#b9bbbe' }}>
          <LogOut size={16} />
        </IconButton>
      </Box>
    </Box>
  );
}