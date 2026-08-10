import { sensitivityToDbfs } from '../voiceSettings';

const CLOSE_HOLD_MS = 320;
const CLOSE_HYSTERESIS_DB = 6;

export interface VoiceActivityGateSettings {
  automatic: boolean;
  sensitivity: number;
}

export class GroupVoiceActivityGate {
  private settings: VoiceActivityGateSettings = {
    automatic: true,
    sensitivity: 50,
  };
  private neuralSpeech = false;
  private levelOpen = false;
  private opened = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onChange: (open: boolean) => void) {}

  configure(settings: VoiceActivityGateSettings): void {
    this.settings = settings;
    this.cancelClose();
    if (!settings.automatic) this.levelOpen = false;
    this.commit(settings.automatic ? this.neuralSpeech : this.levelOpen);
  }

  updateNeuralSpeech(active: boolean): void {
    this.neuralSpeech = active;
    if (this.settings.automatic) this.schedule(active);
  }

  updateInputLevel(dbfs: number): void {
    if (this.settings.automatic || !Number.isFinite(dbfs)) return;
    const threshold = sensitivityToDbfs(this.settings.sensitivity);
    if (dbfs >= threshold) {
      this.levelOpen = true;
      this.schedule(true);
      return;
    }
    if (dbfs <= threshold - CLOSE_HYSTERESIS_DB) {
      this.levelOpen = false;
      this.schedule(false);
    }
  }

  isOpen(): boolean {
    return this.opened;
  }

  reset(): void {
    this.cancelClose();
    this.neuralSpeech = false;
    this.levelOpen = false;
    this.commit(false);
  }

  private schedule(open: boolean): void {
    if (open) {
      this.cancelClose();
      this.commit(true);
      return;
    }
    if (!this.opened || this.closeTimer !== null) return;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      const sourceOpen = this.settings.automatic
        ? this.neuralSpeech
        : this.levelOpen;
      if (!sourceOpen) this.commit(false);
    }, CLOSE_HOLD_MS);
  }

  private commit(open: boolean): void {
    if (this.opened === open) return;
    this.opened = open;
    this.onChange(open);
  }

  private cancelClose(): void {
    if (this.closeTimer === null) return;
    clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }
}
