import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
} from '@mui/material';
import { useAuthStore } from '../store/store';

const LoginPage: React.FC = () => {
  const router = useRouter();
  const { isLoading, error, loginStart, loginSuccess, loginFailure, clearError } = useAuthStore();
  
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });

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
      // Здесь будет вызов API для входа
      // const response = await authService.login(formData);
      // loginSuccess(response.user, response.token);
      // router.push('/');
      
      // Временная заглушка для демонстрации
      const mockUser = {
        id: '1',
        username: formData.username,
        email: 'user@example.com',
      };
      const mockToken = 'mock-token';
      loginSuccess(mockUser, mockToken);
      router.push('/');
    } catch (err) {
      loginFailure(err instanceof Error ? err.message : 'Ошибка входа');
    }
  };

  React.useEffect(() => {
    return () => {
      clearError();
    };
  }, [clearError]);

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