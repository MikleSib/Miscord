import { LockKeyhole } from 'lucide-react';
import type { User } from '../types';
import { UserAvatar } from './ui/user-avatar';

export function DirectMessageHeader({ friend, onOpenSecret }: {
  friend: User;
  onOpenSecret: () => void;
}) {
  return (
    <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-[#2c2d32] px-4 shadow-md">
      <div className="flex min-w-0 items-center">
        <UserAvatar user={friend} />
        <h2 className="ml-3 truncate font-semibold text-white">{friend.username}</h2>
      </div>
      <button
        type="button"
        onClick={onOpenSecret}
        className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-[#a5f3c6] hover:bg-[#24945f]/15"
        aria-label="Открыть секретный чат"
        title="Секретный чат с оконечным шифрованием"
      >
        <LockKeyhole className="h-4 w-4" />
        <span className="hidden sm:inline">Секретный чат</span>
      </button>
    </div>
  );
}
