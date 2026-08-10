export type ActivityRefresh = (
  emitActiveSpeakers: boolean,
  priorityProducerId?: string,
) => Promise<void>;

interface Waiter {
  version: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** Coalesces room-wide activity scans while preserving exact await semantics. */
export class ActivityRefreshQueue {
  private requestedVersion = 0;
  private completedVersion = 0;
  private emitActiveSpeakers = false;
  private priorityProducerId?: string;
  private running = false;
  private closed = false;
  private scheduled?: NodeJS.Immediate;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly refresh: ActivityRefresh) {}

  request(emitActiveSpeakers = true, priorityProducerId?: string): Promise<void> {
    if (this.closed) return Promise.resolve();
    const version = ++this.requestedVersion;
    this.emitActiveSpeakers ||= emitActiveSpeakers;
    if (priorityProducerId) this.priorityProducerId = priorityProducerId;
    const completion = new Promise<void>((resolve, reject) => {
      this.waiters.push({ version, resolve, reject });
    });
    this.ensureRunning();
    return completion;
  }

  close(): void {
    this.closed = true;
    if (this.scheduled) clearImmediate(this.scheduled);
    this.scheduled = undefined;
    this.running = false;
    this.emitActiveSpeakers = false;
    this.priorityProducerId = undefined;
    this.waiters.splice(0).forEach((waiter) => waiter.resolve());
  }

  private ensureRunning(): void {
    if (this.running || this.closed) return;
    this.running = true;
    // WebSocket callbacks from different peers are separate callbacks. Waiting
    // for the check phase coalesces the whole poll-phase burst into one scan.
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      void this.drain().finally(() => {
        this.running = false;
        if (this.requestedVersion > this.completedVersion && !this.closed) this.ensureRunning();
      });
    });
  }

  private async drain(): Promise<void> {
    while (this.completedVersion < this.requestedVersion && !this.closed) {
      const version = this.requestedVersion;
      const emit = this.emitActiveSpeakers;
      const priority = this.priorityProducerId;
      this.emitActiveSpeakers = false;
      this.priorityProducerId = undefined;
      try {
        await this.refresh(emit, priority);
        this.settle(version);
      } catch (error) {
        this.settle(version, error);
      }
    }
  }

  private settle(version: number, error?: unknown): void {
    this.completedVersion = version;
    const ready = this.waiters.filter((waiter) => waiter.version <= version);
    this.waiters.splice(0, ready.length);
    for (const waiter of ready) {
      if (error === undefined) waiter.resolve();
      else waiter.reject(error);
    }
  }
}
