type ReadyWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class UnifiedWebSocketReadiness {
  private ready = false;
  private readonly waiters = new Set<ReadyWaiter>();

  get isReady(): boolean { return this.ready; }

  markReady(): void {
    this.ready = true;
    for (const waiter of this.takeWaiters()) waiter.resolve();
  }

  markUnavailable(): void { this.ready = false; }

  fail(error: Error): void {
    this.ready = false;
    for (const waiter of this.takeWaiters()) waiter.reject(error);
  }

  wait(timeoutMs = 30_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter: ReadyWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('Соединение с сервером не восстановилось. Попробуйте ещё раз.'));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  private takeWaiters(): ReadyWaiter[] {
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const waiter of waiters) clearTimeout(waiter.timer);
    return waiters;
  }
}
