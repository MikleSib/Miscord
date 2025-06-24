import api from './api';
import { User, AuthTokens, LoginCredentials, RegisterData } from '../types';

class AuthService {
  async login(credentials: LoginCredentials): Promise<AuthTokens> {
    const formData = new FormData();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);
    
    const response = await api.post<AuthTokens>('/api/auth/login', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    
    if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', response.data.access_token);
    }
    return response.data;
  }

  async register(data: RegisterData): Promise<User> {
    const response = await api.post<User>('/api/auth/register', data);
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    const response = await api.get<User>('/api/auth/me');
    return response.data;
  }

  async updateProfile(data: { display_name: string }): Promise<User> {
    const response = await api.put<User>('/api/auth/profile', data);
    return response.data;
  }

  async uploadAvatar(file: File): Promise<{ avatar_url: string }> {
    const formData = new FormData();
    formData.append('avatar', file);
    
    const response = await api.post<{ avatar_url: string }>('/api/auth/avatar', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async deleteAvatar(): Promise<void> {
    await api.delete('/api/auth/avatar');
  }

  logout(): void {
    if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
    }
  }

  getToken(): string | null {
    if (typeof window !== 'undefined') {
    return localStorage.getItem('access_token');
    }
    return null;
  }
}

export default new AuthService();