export class SingleFlight {
  private current: Promise<void> | null = null;
  private currentKey: unknown = null;

  run(task: () => Promise<void>, key: unknown = 'default'): Promise<void> {
    if (this.current && this.currentKey === key) return this.current;
    const pending = task();
    this.current = pending;
    this.currentKey = key;
    return pending.finally(() => {
      if (this.current === pending) {
        this.current = null;
        this.currentKey = null;
      }
    });
  }
}
