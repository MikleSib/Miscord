import type { Channel, Message, Server, User } from '../types'

export interface AppState {
  // Данные
  servers: Server[];
  currentServer: Server | null;
  currentChannel: Channel | null;
  messages: { [channelId: number]: Message[] };
  user: User | null;
  isLoading: boolean;
  error: string | null;
  typingStatus: { [channelId: number]: { username: string; timeoutId: NodeJS.Timeout }[] };
  currentServerMembers: User[];
  appView: 'home' | 'server';

  // Действия для серверов
  selectServer: (serverId: number) => Promise<void>;
  selectChannel: (channelId: number, channelType?: 'text' | 'voice') => void;
  addServer: (server: Server) => void;
  updateServer: (serverId: number, updates: Partial<Server>) => void;
  removeServer: (serverId: number) => void;

  // Действия для каналов
  addChannel: (serverId: number, channel: Channel) => void;
  updateChannel: (
    serverId: number,
    channelId: number,
    channelType: 'text' | 'voice',
    updates: Partial<Channel>
  ) => void;
  removeChannel: (
    serverId: number,
    channelId: number,
    channelType: 'text' | 'voice'
  ) => void;

  // Сообщения
  sendMessage: (content: string, files: File[]) => Promise<void>;
  addMessage: (message: Message) => void;
  sendTyping: () => void;
  setTyping: (channelId: number, username: string) => void;
  clearTyping: (channelId: number, username: string) => void;

  // Пользователь
  setUser: (user: User | null) => void;
  logout: () => void;

  // Загрузка данных
  loadServers: () => Promise<void>;
  loadServerDetails: (serverId: number) => Promise<void>;

  // Состояние
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // WebSocket
  initializeWebSocket: (token: string) => void;
  disconnectWebSocket: () => void;
}
