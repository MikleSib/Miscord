type SinkAudio = HTMLAudioElement & { setSinkId(id: string): Promise<void> };

interface ApplyOptions {
  deviceId: string;
  elements: HTMLAudioElement[];
  onUnsupported: () => void;
}

export class GroupVoiceOutputSwitch {
  private revision = 0;
  private desiredDeviceId = 'default';

  async apply(options: ApplyOptions): Promise<void> {
    const request = ++this.revision;
    this.desiredDeviceId = options.deviceId;
    try {
      await this.applyToElements(options.deviceId, options.elements, options.onUnsupported);
    } catch (error) {
      if (request !== this.revision) await this.reconcile(options.elements, options.onUnsupported);
      throw error;
    }
    if (request !== this.revision) await this.reconcile(options.elements, options.onUnsupported);
  }

  private async reconcile(elements: HTMLAudioElement[], onUnsupported: () => void): Promise<void> {
    for (;;) {
      const revision = this.revision;
      const desired = this.desiredDeviceId;
      await this.applyToElements(desired, elements, onUnsupported);
      if (revision === this.revision) return;
    }
  }

  private async applyToElements(
    deviceId: string,
    elements: HTMLAudioElement[],
    onUnsupported: () => void,
  ): Promise<void> {
    for (const audio of elements) {
      if (!('setSinkId' in audio)) {
        onUnsupported();
        continue;
      }
      await (audio as SinkAudio).setSinkId(deviceId);
    }
  }
}
