'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
} from '@mui/material';
import { useAuthStore } from '../../store/store';
import { useStore } from '../../lib/store';
import authService from '../../services/authService';

const LoginPage: React.FC = () => {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, error, loginStart, loginSuccess, loginFailure, clearError } = useAuthStore();
  const { setUser: setStoreUser } = useStore();
  const [isMounted, setIsMounted] = useState(false);
  
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    loginStart();
    
    try {
      const { access_token } = await authService.login(formData);
      
      // Сначала сохраняем токен в хранилище
      useAuthStore.getState().setToken(access_token);

      // Теперь делаем запрос с уже установленным токеном
      const user = await authService.getCurrentUser();
      
      // Сохраняем пользователя в оба store
      loginSuccess(user, access_token);
      setStoreUser(user);
      
    
    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || 'Ошибка входа';
      loginFailure(errorMessage);
    }
  };

  useEffect(() => {
    // Этот эффект будет следить за состоянием аутентификации
    // и выполнять перенаправление после успешного входа.
    if (isMounted && isAuthenticated && user) {
      router.push('/');
    }
  }, [isAuthenticated, user, router, isMounted]);

  useEffect(() => {
    return () => {
      clearError();
    };
  }, [clearError]);

  // Не рендерим до тех пор, пока компонент не смонтирован
  if (!isMounted) {
    return null;
  }

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper elevation={3} sx={{ padding: 4, width: '100%' }}>
          <Typography component="h1" variant="h4" align="center" gutterBottom>
            Войти в Miscord
          </Typography>
          
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          
          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1 }}>
            <TextField
              margin="normal"
              required
              fullWidth
              id="username"
              label="Имя пользователя"
              name="username"
              autoComplete="username"
              autoFocus
              value={formData.username}
              onChange={handleChange}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              name="password"
              label="Пароль"
              type="password"
              id="password"
              autoComplete="current-password"
              value={formData.password}
              onChange={handleChange}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
              disabled={isLoading}
            >
              {isLoading ? 'Вход...' : 'Войти'}
            </Button>
            <Box textAlign="center">
              <Link href="/register" style={{ textDecoration: 'none' }}>
                <Typography variant="body2" color="primary" sx={{ cursor: 'pointer' }}>
                  Нет аккаунта? Зарегистрироваться
                </Typography>
              </Link>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default LoginPage; 