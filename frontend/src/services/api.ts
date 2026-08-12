import axios from 'axios';
import { useAuthStore } from '@/store/store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miscord.ru';

const api = axios.create({
  baseURL: `${API_URL}`,
  withCredentials: true,
});

let refreshPromise: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios.post<{ access_token: string }>(
      `${API_URL}/api/v1/auth/refresh`,
      undefined,
      { withCredentials: true },
    ).then((response) => {
      useAuthStore.getState().setToken(response.data.access_token);
      return response.data.access_token;
    }).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

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
api.interceptors.response.use((response) => response, async (error) => {
  const config = error.config as (typeof error.config & { _miscordRetried?: boolean }) | undefined;
  const url = String(config?.url || '');
  const isAuthBootstrap = url.includes('/auth/login') || url.includes('/auth/refresh');
  if (error.response?.status !== 401 || !config || config._miscordRetried || isAuthBootstrap) {
    if (error.response?.status === 401 && !isAuthBootstrap) useAuthStore.getState().logout();
    return Promise.reject(error);
  }
  config._miscordRetried = true;
  try {
    const token = await refreshAccessToken();
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
    return api.request(config);
  } catch {
    useAuthStore.getState().logout();
    return Promise.reject(error);
  }
});

export const channelApi = {
  getChannelMessages: async (channelId: number, limit = 50, before?: number) => {
    const params: { limit: number; before?: number } = { limit };
    if (before) {
      params.before = before;
    }
    
    const response = await api.get(`/api/v1/channels/text/${channelId}/messages`, { params });
    return response.data;
  },
};

export default api;
