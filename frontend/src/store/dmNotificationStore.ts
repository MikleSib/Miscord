import { create } from 'zustand';
import { User } from '../types';
import soundService from '../services/soundService';
import websocketService from '../services/websocketService';
import { useAuthStore } from './store';

export type DmNotificationEntry = {
  user: User;
  unreadCount: number;
};

type IncomingDmPayload = {
  data?: {
    sender_id?: number;
    recipient_id?: number;
    author?: User;
  };
};

interface DmNotificationState {
  /** userId → непросмотренные ЛС (иконки под Home). */
  pending: Record<number, DmNotificationEntry>;
  /** С кем сейчас открыт чат — новые сообщения не копят badge. */
  activeViewUserId: number | null;
  addIncomingDm: (message: NonNullable<IncomingDmPayload['data']>) => void;
  markViewed: (userId: number) => void;
  setActiveView: (userId: number | null) => void;
  clearAll: () => void;
}

function buildSenderUser(message: NonNullable<IncomingDmPayload['data']>): User | null {
  const senderId = message.sender_id;
  if (!senderId) return null;

  if (message.author?.id === senderId) {
    return message.author;
  }

  return {
    id: senderId,
    username: message.author?.username || `user_${senderId}`,
    email: message.author?.email || '',
    display_name: message.author?.display_name,
    avatar_url: message.author?.avatar_url,
    is_online: message.author?.is_online,
  };
}

export const useDmNotificationStore = create<DmNotificationState>((set, get) => ({
  pending: {},
  activeViewUserId: null,

  addIncomingDm: (message) => {
    const senderId = message.sender_id;
    if (!senderId) return;

    const currentUserId = useAuthStore.getState().user?.id;
    if (!currentUserId || senderId === currentUserId) return;
    if (get().activeViewUserId === senderId) return;

    const sender = buildSenderUser(message);
    if (!sender) return;

    set((state) => {
      const existing = state.pending[senderId];
      return {
        pending: {
          ...state.pending,
          [senderId]: {
            user: existing ? { ...existing.user, ...sender } : sender,
            unreadCount: (existing?.unreadCount ?? 0) + 1,
          },
        },
      };
    });

    soundService.playDmNotificationSound();
  },

  markViewed: (userId) => {
    set((state) => {
      if (!state.pending[userId]) return state;
      const next = { ...state.pending };
      delete next[userId];
      return { pending: next };
    });
  },

  setActiveView: (userId) => {
    set({ activeViewUserId: userId });
    if (userId !== null) {
      get().markViewed(userId);
    }
  },

  clearAll: () => set({ pending: {}, activeViewUserId: null }),
}));

let dmListenerRegistered = false;

/** Один раз на приложение — слушаем входящие ЛС глобально (даже на сервере). */
export function registerDmNotificationListener(): void {
  if (dmListenerRegistered || typeof window === 'undefined') return;
  dmListenerRegistered = true;

  websocketService.on('dm', (payload: IncomingDmPayload) => {
    const message = payload?.data;
    if (!message) return;
    useDmNotificationStore.getState().addIncomingDm(message);
  });
}

export function selectPendingDmNotifications(state: DmNotificationState): DmNotificationEntry[] {
  return Object.values(state.pending).sort((a, b) => b.unreadCount - a.unreadCount);
}
