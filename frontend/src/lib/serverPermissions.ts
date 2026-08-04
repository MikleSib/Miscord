import { useEffect, useMemo } from 'react';
import { create } from 'zustand';

import serverService from '../services/serverService';
import websocketService from '../services/websocketService';
import { useAuthStore } from '../store/store';
import { ServerMembershipInfo } from '../types';
import { hasPermission } from './permissions';

interface ServerPermissionsState {
  byServer: Record<number, ServerMembershipInfo>;
  pending: Record<number, boolean>;
  load: (serverId: number, options?: { force?: boolean }) => Promise<void>;
  invalidate: (serverId?: number) => void;
}

export const useServerPermissionsStore = create<ServerPermissionsState>((set, get) => ({
  byServer: {},
  pending: {},

  load: async (serverId: number, options = {}) => {
    if (!serverId) return;

    const { byServer, pending } = get();
    if (pending[serverId]) return;
    if (byServer[serverId] && !options.force) return;

    set((state) => ({ pending: { ...state.pending, [serverId]: true } }));
    try {
      const info = await serverService.getMyMembership(serverId);
      set((state) => ({
        byServer: { ...state.byServer, [serverId]: info },
      }));
    } catch (error) {
      // Например, пользователь больше не участник — тихо игнорируем
      console.warn('[ServerPermissions] Не удалось загрузить права сервера', serverId, error);
    } finally {
      set((state) => {
        const nextPending = { ...state.pending };
        delete nextPending[serverId];
        return { pending: nextPending };
      });
    }
  },

  invalidate: (serverId?: number) => {
    if (serverId === undefined) {
      set({ byServer: {} });
      return;
    }
    set((state) => {
      const next = { ...state.byServer };
      delete next[serverId];
      return { byServer: next };
    });
  },
}));

/** Перезагружает права сервера, если они уже были загружены. */
function refresh(serverId?: number): void {
  if (!serverId) return;
  void useServerPermissionsStore.getState().load(serverId, { force: true });
}

let syncBound = false;

/** Подписка на события, которые могут изменить права текущего пользователя. */
export function bindServerPermissionsSync(): void {
  if (syncBound || typeof window === 'undefined') return;
  syncBound = true;

  const onRoleEvent = (payload: any) => {
    refresh(payload?.data?.server_id ?? payload?.server_id);
  };

  websocketService.on('server_role_created', onRoleEvent);
  websocketService.on('server_role_updated', onRoleEvent);
  websocketService.on('server_role_deleted', onRoleEvent);
  websocketService.on('server_roles_reordered', onRoleEvent);
  websocketService.on('server_ownership_transferred', onRoleEvent);

  websocketService.on('server_member_roles_updated', (payload: any) => {
    const data = payload?.data ?? payload;
    const currentUserId = useAuthStore.getState().user?.id;
    if (data?.user_id === currentUserId) {
      refresh(data?.server_id);
    }
  });
}

export function useServerPermissions(serverId?: number | null) {
  const info = useServerPermissionsStore((state) =>
    serverId ? state.byServer[serverId] : undefined
  );
  const load = useServerPermissionsStore((state) => state.load);

  useEffect(() => {
    if (serverId) {
      void load(serverId);
    }
  }, [serverId, load]);

  return useMemo(() => {
    const permissions = info?.permissions ?? 0;
    const isOwner = info?.is_owner ?? false;
    return {
      isLoaded: Boolean(info),
      isOwner,
      permissions,
      topRolePosition: info?.top_role_position ?? 0,
      roles: info?.roles ?? [],
      can: (permission: number) => isOwner || hasPermission(permissions, permission),
    };
  }, [info]);
}
