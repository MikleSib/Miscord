import api from './api';

export interface OnlineUser {
  id: number;
  username: string;
  email: string;
  avatar_url?: string;
  is_online: boolean;
  last_activity?: string;
}

export interface OnlineUsersResponse {
  online_users: OnlineUser[];
  count: number;
}

export const onlineUsersService = {
  async getOnlineUsers(): Promise<OnlineUsersResponse> {
    const response = await api.get('/api/channels/online-users');
    return response.data;
  }
}; 