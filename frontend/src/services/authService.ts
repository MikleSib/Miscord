import api from './api';
import { User, AuthTokens, LoginCredentials, RegisterData, RegistrationChallenge } from '../types';
import { useAuthStore } from '../store/store';

class AuthService {
  async login(credentials: LoginCredentials): Promise<AuthTokens> {
    const formData = new FormData();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);
    if (credentials.otp) formData.append('otp', credentials.otp);
    
    const response = await api.post<AuthTokens>('/api/v1/auth/login', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    
    return response.data;
  }

  async register(data: RegisterData): Promise<RegistrationChallenge> {
    const response = await api.post<RegistrationChallenge>('/api/v1/auth/register', data);
    return response.data;
  }

  async verifyRegistration(challengeId: string, code: string): Promise<User> {
    const response = await api.post<User>('/api/v1/auth/register/verify', {
      challenge_id: challengeId,
      code,
    });
    return response.data;
  }

  async resendRegistrationCode(challengeId: string): Promise<RegistrationChallenge> {
    const response = await api.post<RegistrationChallenge>('/api/v1/auth/register/resend', {
      challenge_id: challengeId,
    });
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    const response = await api.get<User>('/api/v1/auth/me');
    return response.data;
  }

  async updateProfile(data: { display_name: string }): Promise<User> {
    const response = await api.put<User>('/api/v1/auth/profile', data);
    return response.data;
  }

  async uploadAvatar(file: File): Promise<{ avatar_url: string }> {
    const formData = new FormData();
    formData.append('avatar', file);
    
    const response = await api.post<{ avatar_url: string }>('/api/v1/auth/avatar', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async deleteAvatar(): Promise<void> {
    await api.delete('/api/v1/auth/avatar');
  }

  async logout(): Promise<void> {
    await api.post('/api/v1/auth/logout').catch(() => undefined);
  }

  async restoreSession(): Promise<{ user: User; accessToken: string }> {
    if (typeof window !== 'undefined') localStorage.removeItem('access_token');
    const response = await api.post<AuthTokens>('/api/v1/auth/refresh');
    useAuthStore.getState().setToken(response.data.access_token);
    const user = await this.getCurrentUser();
    return { user, accessToken: response.data.access_token };
  }

  async startPasswordReset(email: string) {
    return (await api.post<{ challenge_id: string; message: string }>('/api/v1/auth/password-reset/start', { email })).data;
  }

  async finishPasswordReset(challengeId: string, code: string, newPassword: string) {
    await api.post('/api/v1/auth/password-reset/finish', {
      challenge_id: challengeId,
      code,
      new_password: newPassword,
    });
  }

  getToken(): string | null {
    return useAuthStore.getState().token;
  }
}

export default new AuthService();
