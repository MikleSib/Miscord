import React, { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import channelService from '../services/channelService';
import { UserAvatar } from './ui/user-avatar';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { User } from '../types';

export function ServerUserSidebar() {
  const { currentServerMembers, currentServer } = useStore();
  const [collapsed, setCollapsed] = useState(false);

  if (!currentServer || collapsed) {
    return null;
  }

  const users: User[] = currentServerMembers || [];
  const online: User[] = users.filter((u: User) => u.is_online);
  const offline: User[] = users.filter((u: User) => !u.is_online);

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