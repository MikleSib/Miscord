import axios from 'axios';
import { useAuthStore } from '@/store/store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miscord.ru';

const api = axios.create({
  baseURL: API_URL,
});

// Добавление токена к запросам
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Обработка ошибок
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default api;