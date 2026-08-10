import { VoiceLifecycleSupersededError } from './voiceLifecycle';

type PendingInput = {
  revision: number;
  resolve: () => void;
  reject: (error: Error) => void;
};

export class GroupVoiceInputState {
  revision = 0;
  appliedRevision = 0;
  desiredDeviceId: string;
  appliedDeviceId: string;
  joining = false;
  private pending: PendingInput | null = null;

  constructor(initialDeviceId: string) {
    this.desiredDeviceId = initialDeviceId;
    this.appliedDeviceId = initialDeviceId;
  }

  request(deviceId: string): number {
    const revision = ++this.revision;
    this.desiredDeviceId = deviceId;
    this.reject(new VoiceLifecycleSupersededError());
    return revision;
  }

  waitFor(revision: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isCurrent(revision)) {
        reject(new VoiceLifecycleSupersededError());
        return;
      }
      this.pending = { revision, resolve, reject };
    });
  }

  markApplied(deviceId: string, revision: number): void {
    this.appliedDeviceId = deviceId;
    this.appliedRevision = revision;
    if (this.isCurrent(revision)) this.desiredDeviceId = deviceId;
  }

  resolve(revision: number): void {
    if (this.pending?.revision !== revision) return;
    const pending = this.pending;
    this.pending = null;
    pending.resolve();
  }

  reject(error: Error): void {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    if (this.isCurrent(pending.revision)) this.rollback();
    pending.reject(error);
  }

  assertCurrent(revision: number): void {
    if (!this.isCurrent(revision)) throw new VoiceLifecycleSupersededError();
  }

  async reconcile(
    apply: (deviceId: string, revision: number, assertCurrent: () => void) => Promise<void>,
    onFailure: () => void,
  ): Promise<void> {
    while (this.appliedRevision !== this.revision) {
      const revision = this.revision;
      try {
        await apply(this.desiredDeviceId, revision, () => this.assertCurrent(revision));
      } catch (error) {
        if (!this.isCurrent(revision)) continue;
        const failure = error instanceof Error ? error : new Error(String(error));
        this.reject(failure);
        onFailure();
        throw failure;
      }
    }
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }

  rollback(): void {
    this.desiredDeviceId = this.appliedDeviceId;
  }
}
