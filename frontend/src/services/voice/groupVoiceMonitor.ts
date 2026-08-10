import type { SfuTransport } from './sfuTransport';

interface BeginMonitorOptions {
  waitForJoin: Promise<void> | null;
  getTransport: () => SfuTransport | null;
  getStream: () => MediaStream | null;
  reconcileGate: () => Promise<void>;
  onReady: () => void;
}

export class GroupVoiceMonitor {
  active = false;
  private revision = 0;

  async begin(options: BeginMonitorOptions): Promise<MediaStream | null> {
    const revision = ++this.revision;
    this.active = true;
    await options.waitForJoin?.catch(() => undefined);
    const transport = options.getTransport();
    const stream = options.getStream();
    if (!transport || !stream || revision !== this.revision) {
      if (revision === this.revision) this.active = false;
      return null;
    }
    try {
      await transport.setMicrophoneMuted(true);
    } catch (error) {
      await this.rollbackIfOwner(revision, transport, options);
      throw error;
    }
    if (
      revision !== this.revision ||
      options.getTransport() !== transport ||
      options.getStream() !== stream
    ) {
      await this.rollbackIfOwner(revision, transport, options);
      return null;
    }
    options.onReady();
    return stream;
  }

  async end(reconcileGate: () => Promise<void>): Promise<void> {
    this.revision += 1;
    if (!this.active) return;
    this.active = false;
    await reconcileGate();
  }

  invalidate(): void {
    this.revision += 1;
    this.active = false;
  }

  private async rollbackIfOwner(
    revision: number,
    transport: SfuTransport,
    options: BeginMonitorOptions,
  ): Promise<void> {
    if (revision !== this.revision || options.getTransport() !== transport) return;
    this.invalidate();
    await options.reconcileGate().catch(() => undefined);
  }
}
