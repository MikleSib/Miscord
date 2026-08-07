import { User } from '../types';

export type PendingDirectMessage = {
  user: User;
  message?: string;
};

let pendingDirectMessage: PendingDirectMessage | null = null;

/** Сохраняет получателя и текст, затем сигналит HomePageContent открыть чат. */
export function queueDirectMessage(user: User, message?: string) {
  pendingDirectMessage = { user, message: message?.trim() || undefined };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('open_direct_message'));
  }
}

/** Забирает отложенный переход в DM (один раз). */
export function consumePendingDirectMessage(): PendingDirectMessage | null {
  const pending = pendingDirectMessage;
  pendingDirectMessage = null;
  return pending;
}
