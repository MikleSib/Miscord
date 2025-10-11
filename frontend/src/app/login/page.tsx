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
  InputAdornment,
  IconButton,
  Fade,
  Zoom,
} from '@mui/material';
import {
  Person as PersonIcon,
  Lock as LockIcon,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
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
  const [showPassword, setShowPassword] = useState(false);

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
    // Проверяем, есть ли уже сохраненный токен
    const checkExistingAuth = async () => {
      try {
        const savedToken = localStorage.getItem('access_token');
        if (savedToken) {
          // Проверяем валидность токена
          const user = await authService.getCurrentUser();
          if (user) {
            useAuthStore.getState().loginSuccess(user, savedToken);
            setStoreUser(user);
            router.push('/');
            return;
          }
        }
      } catch (error) {
        // Очищаем недействительный токен
        localStorage.removeItem('access_token');
        useAuthStore.getState().logout();
      }
    };

    if (isMounted) {
      checkExistingAuth();
    }
  }, [isMounted, router, setStoreUser]);

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
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 2,
      }}
    >
      <Container component="main" maxWidth="xs">
        <Fade in={isMounted} timeout={800}>
          <Box>
            <Zoom in={isMounted} timeout={1000}>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  mb: 3,
                }}
              >
                <Box
                  sx={{
                    mb: 2,
                  }}
                >
                  <img 
                    src="/image.svg" 
                    alt="Miscord Logo" 
                    style={{ 
                      width: '120px', 
                      height: 'auto',
                      filter: 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))'
                    }} 
                  />
                </Box>
                <Typography
                  variant="h3"
                  sx={{
                    color: 'white',
                    fontWeight: 700,
                    textShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  Miscord
                </Typography>
                <Typography
                  variant="body1"
                  sx={{
                    color: 'rgba(255, 255, 255, 0.9)',
                    mt: 1,
                  }}
                >
                  Войдите в свой аккаунт
                </Typography>
              </Box>
            </Zoom>

            <Paper
              elevation={12}
              sx={{
                padding: 4,
                width: '100%',
                borderRadius: 3,
                background: 'rgba(255, 255, 255, 0.95)',
                backdropFilter: 'blur(10px)',
              }}
            >
              {error && (
                <Fade in={!!error}>
                  <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                    {error}
                  </Alert>
                </Fade>
              )}

              <Box component="form" onSubmit={handleSubmit}>
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
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonIcon sx={{ color: '#667eea' }} />
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      '&:hover fieldset': {
                        borderColor: '#667eea',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#667eea',
                      },
                    },
                    '& .MuiInputLabel-root.Mui-focused': {
                      color: '#667eea',
                    },
                  }}
                />
                <TextField
                  margin="normal"
                  required
                  fullWidth
                  name="password"
                  label="Пароль"
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  autoComplete="current-password"
                  value={formData.password}
                  onChange={handleChange}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockIcon sx={{ color: '#667eea' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="toggle password visibility"
                          onClick={() => setShowPassword(!showPassword)}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      '&:hover fieldset': {
                        borderColor: '#667eea',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#667eea',
                      },
                    },
                    '& .MuiInputLabel-root.Mui-focused': {
                      color: '#667eea',
                    },
                  }}
                />
                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  disabled={isLoading}
                  sx={{
                    mt: 3,
                    mb: 2,
                    py: 1.5,
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    borderRadius: 2,
                    textTransform: 'none',
                    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)',
                    '&:hover': {
                      background: 'linear-gradient(135deg, #5568d3 0%, #6a3f8f 100%)',
                      boxShadow: '0 6px 16px rgba(102, 126, 234, 0.5)',
                      transform: 'translateY(-2px)',
                    },
                    '&:disabled': {
                      background: 'linear-gradient(135deg, #a0a0a0 0%, #808080 100%)',
                    },
                    transition: 'all 0.3s ease',
                  }}
                >
                  {isLoading ? 'Вход...' : 'Войти'}
                </Button>
                <Box textAlign="center">
                  <Link href="/register" style={{ textDecoration: 'none' }}>
                    <Typography
                      variant="body2"
                      sx={{
                        cursor: 'pointer',
                        color: '#667eea',
                        fontWeight: 500,
                        '&:hover': {
                          textDecoration: 'underline',
                        },
                      }}
                    >
                      Нет аккаунта? Зарегистрироваться
                    </Typography>
                  </Link>
                </Box>
              </Box>
            </Paper>
          </Box>
        </Fade>
      </Container>
    </Box>
  );
};

export default LoginPage; 