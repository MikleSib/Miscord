import React, { useEffect } from 'react';
import { useAuthStore } from './store/store';
import { CircularProgress, Box } from '@mui/material';

function App() {
  const { isAuthenticated, isLoading } = useAuthStore();

  useEffect(() => {
    // Здесь будет проверка аутентификации
    // checkAuth();
  }, []);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <div>
      {isAuthenticated ? (
        <div>Главная страница</div>
      ) : (
        <div>Страница входа</div>
      )}
    </div>
  );
}

export default App;