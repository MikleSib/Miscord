import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { UserAvatar } from './ui/user-avatar';
import { User } from '../types';
import { onlineUsersService, OnlineUser } from '../services/onlineUsersService';

export function ServerUserSidebar() {
  const { currentServerMembers, currentServer } = useStore();
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);



  // Загружаем онлайн пользователей при монтировании
  useEffect(() => {
    const loadOnlineUsers = async () => {
      try {
        const response = await onlineUsersService.getOnlineUsers();
        setOnlineUsers(response.online_users);
      } catch (error) {
        console.error('Ошибка загрузки онлайн пользователей:', error);
      }
    };

    loadOnlineUsers();

    // Подписываемся на изменения статуса пользователей через глобальные события
    const handleUserStatusChanged = (event: any) => {
      const eventData = event.detail;
      
      // Данные могут быть в event.detail.data или напрямую в event.detail
      const data = eventData.data || eventData;
      
      setOnlineUsers(prev => {

        
        const updated = prev.filter(u => u.id !== data.user_id);
        if (data.is_online) {
          // Добавляем пользователя в онлайн
          updated.push({
            id: data.user_id,
            username: data.username,
            email: '', // Не передается в WebSocket
            is_online: true
          });
        }
        
        return updated;
      });
      
      // Принудительно обновляем компонент
    };

    const handleUserProfileUpdated = () => {
      setOnlineUsers((prev) => [...prev]);
    };

    const handleServerMemberJoined = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const member = detail.user;
      if (!member?.id) return;

      if (member.is_online) {
        setOnlineUsers((prev) => {
          if (prev.some((user) => user.id === member.id)) return prev;
          return [
            ...prev,
            {
              id: member.id,
              username: member.display_name || member.username,
              email: member.email || '',
              is_online: true,
            },
          ];
        });
      }
    };

    const handleServerMemberLeft = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (!detail.user_id) return;
      setOnlineUsers((prev) => prev.filter((user) => user.id !== detail.user_id));
    };

    window.addEventListener('user_status_changed', handleUserStatusChanged);
    window.addEventListener('user_profile_updated', handleUserProfileUpdated);
    window.addEventListener('server_member_joined', handleServerMemberJoined);
    window.addEventListener('server_member_left', handleServerMemberLeft);

    // Периодически обновляем список (каждые 2 минуты)
    const interval = setInterval(loadOnlineUsers, 2 * 60 * 1000);

    return () => {
      clearInterval(interval);
      window.removeEventListener('user_status_changed', handleUserStatusChanged);
      window.removeEventListener('user_profile_updated', handleUserProfileUpdated);
      window.removeEventListener('server_member_joined', handleServerMemberJoined);
      window.removeEventListener('server_member_left', handleServerMemberLeft);
    };
  }, [currentServer?.id]);

  if (!currentServer) {
    return null;
  }

  // Объединяем участников сервера с онлайн статусом
  const serverMembers: User[] = currentServerMembers || [];
  const membersWithStatus = serverMembers.map(member => ({
    ...member,
    is_online: onlineUsers.some(ou => ou.id === member.id)
  }));
  
  const online: User[] = membersWithStatus.filter((u: User) => u.is_online);
  const offline: User[] = membersWithStatus.filter((u: User) => !u.is_online);

  return (
    <div className="relative flex h-full w-60 flex-col overflow-hidden border-l border-[#3e3f45] bg-[#323339]">
      <div className="app-header border-b px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Участники сервера
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        <div>
          <div className="text-xs text-green-500 font-bold mb-1">Онлайн — {online.length}</div>
          {online.length === 0 && <div className="text-xs text-muted-foreground">Нет онлайн</div>}
          {online.map((user: User) => (
            <div key={user.id} className="interactive-row flex items-center gap-2 px-2 py-1.5">
              <UserAvatar user={user} size={32} />
              <span className="font-medium text-sm text-foreground">{user.display_name || user.username}</span>
              <span className="ml-auto w-2 h-2 rounded-full bg-green-500" title="Онлайн" />
            </div>
          ))}
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-bold mb-1">Оффлайн — {offline.length}</div>
          {offline.length === 0 && <div className="text-xs text-muted-foreground">Все онлайн</div>}
          {offline.map((user: User) => (
            <div key={user.id} className="interactive-row flex items-center gap-2 px-2 py-1.5 opacity-60">
              <UserAvatar user={user} size={32} />
              <span className="font-medium text-sm text-foreground">{user.display_name || user.username}</span>
              <span className="ml-auto w-2 h-2 rounded-full bg-gray-400" title="Оффлайн" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 