import type { VoiceJoinedPayload } from './types';

type PendingJoin = {
  resolve: (payload: VoiceJoinedPayload) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class GroupVoiceJoinWaiter {
  private pending: PendingJoin | null = null;

  wait(): Promise<VoiceJoinedPayload> {
    this.reject(new Error('Новый вход в голосовой канал отменил предыдущий.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.reject(new Error('Сервер не подтвердил вход в голосовой канал. Повторите подключение.')),
        10_000,
      );
      this.pending = { resolve, reject, timer };
    });
  }

  resolve(payload: VoiceJoinedPayload): void {
    if (!this.pending) return;
    const pending = this.take();
    pending?.resolve(payload);
  }

  reject(error: Error): void {
    if (!this.pending) return;
    const pending = this.take();
    pending?.reject(error);
  }

  get isPending(): boolean {
    return this.pending !== null;
  }

  private take(): PendingJoin | null {
    const pending = this.pending;
    this.pending = null;
    if (pending) clearTimeout(pending.timer);
    return pending;
  }
}
