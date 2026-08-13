import { LockKeyhole } from 'lucide-react';
import type { User } from '../types';
import { UserAvatar } from './ui/user-avatar';

export function DirectMessageHeader({ friend, onOpenSecret }: {
  friend: User;
  onOpenSecret: () => void;
}) {
  const displayName = friend.display_name || friend.username;

  return (
    <header className="direct-message-header">
      <div className="direct-message-header__identity">
        <span className="direct-message-header__avatar">
          <UserAvatar user={friend} size={24} />
          <i className={friend.is_online ? 'is-online' : undefined} aria-hidden="true" />
        </span>
        <span className="direct-message-header__copy">
          <strong>{displayName}</strong>
          {friend.display_name && <small>@{friend.username}</small>}
        </span>
      </div>
      <button
        type="button"
        onClick={onOpenSecret}
        className="direct-message-header__secret"
        aria-label="Открыть секретный чат"
        title="Секретный чат с оконечным шифрованием"
      >
        <LockKeyhole className="h-4 w-4" />
        <span className="hidden sm:inline">Секретный чат</span>
      </button>
    </header>
  );
}
