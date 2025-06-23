import React, { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import channelService from '../services/channelService';
import { UserAvatar } from './ui/user-avatar';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { User } from '../types';
import { onlineUsersService, OnlineUser } from '../services/onlineUsersService';

export function ServerUserSidebar() {
  const { currentServerMembers, currentServer } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

  // Отладочная информация
  console.log('ServerUserSidebar render:', {
    currentServer: currentServer?.name,
    currentServerMembers: currentServerMembers?.length,
    onlineUsers: onlineUsers.length,
    serverMembers: currentServerMembers
  });

  // Загружаем онлайн пользователей при монтировании
  useEffect(() => {
    const loadOnlineUsers = async () => {
      try {
        const response = await onlineUsersService.getOnlineUsers();
        console.log('Загружены онлайн пользователи:', response.online_users);
        setOnlineUsers(response.online_users);
      } catch (error) {
        console.error('Ошибка загрузки онлайн пользователей:', error);
      }
    };

    loadOnlineUsers();

    // Подписываемся на изменения статуса пользователей через глобальные события
    const handleUserStatusChanged = (event: any) => {
      const data = event.detail;
      console.log('ServerUserSidebar получил событие изменения статуса:', data);
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
    };

    window.addEventListener('user_status_changed', handleUserStatusChanged);

    // Периодически обновляем список (каждые 2 минуты)
    const interval = setInterval(loadOnlineUsers, 2 * 60 * 1000);

    return () => {
      clearInterval(interval);
      window.removeEventListener('user_status_changed', handleUserStatusChanged);
    };
  }, [currentServer?.id]);

  if (!currentServer || collapsed) {
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
    <div className="w-64 bg-background border-l border-border flex flex-col h-full relative overflow-hidden">
      <div className="p-4 pb-2 border-b border-border font-semibold text-sm text-muted-foreground">
        Участники сервера
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        <div>
          <div className="text-xs text-green-500 font-bold mb-1">Онлайн — {online.length}</div>
          {online.length === 0 && <div className="text-xs text-muted-foreground">Нет онлайн</div>}
          {online.map((user: User) => (
            <div key={user.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted transition">
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
            <div key={user.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted transition opacity-60">
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