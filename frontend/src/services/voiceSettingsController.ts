import { useAudioDeviceStore } from '../store/audioDeviceStore';
import { useNoiseSuppressionStore } from '../store/noiseSuppressionStore';
import { useVADSettingsStore } from '../store/vadSettingsStore';
import { useVoiceProcessingSettingsStore } from '../store/voiceProcessingSettingsStore';
import optimizedVoiceService from './optimizedVoiceService';
import {
  getVoiceSettingsSnapshot,
  type VoiceProcessingProfile,
  type VoiceProcessingSettings,
  type VoiceSettingsSnapshot,
} from './voiceSettings';

class VoiceSettingsController {
  private inputDeviceRequest = 0;
  private outputDeviceRequest = 0;

  getSnapshot(): VoiceSettingsSnapshot {
    return getVoiceSettingsSnapshot();
  }

  async applyCurrentSettings(): Promise<void> {
    const snapshot = this.getSnapshot();
    const noiseStore = useNoiseSuppressionStore.getState();
    noiseStore.setEnabled(snapshot.processing.noiseSuppression);
    noiseStore.setEngine(snapshot.processing.noiseSuppressionEngine);
    await optimizedVoiceService.applySettings(snapshot);
  }

  async setProfile(profile: VoiceProcessingProfile): Promise<void> {
    useVoiceProcessingSettingsStore.getState().setProfile(profile);
    await this.applyCurrentSettings();
  }

  async updateProcessing(
    settings: Partial<VoiceProcessingSettings>,
  ): Promise<void> {
    useVoiceProcessingSettingsStore.getState().updateCustomSettings(settings);
    await this.applyCurrentSettings();
  }

  async setInputDevice(deviceId: string): Promise<void> {
    const request = ++this.inputDeviceRequest;
    try {
      await optimizedVoiceService.switchInputDevice(deviceId);
      if (request === this.inputDeviceRequest) {
        useAudioDeviceStore.getState().setInputDeviceId(optimizedVoiceService.getAppliedInputDeviceId());
      }
    } catch (error) {
      if (request === this.inputDeviceRequest) {
        useAudioDeviceStore.getState().setInputDeviceId(optimizedVoiceService.getAppliedInputDeviceId());
      }
      throw error;
    }
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    const request = ++this.outputDeviceRequest;
    await optimizedVoiceService.setOutputDevice(deviceId);
    if (request === this.outputDeviceRequest) useAudioDeviceStore.getState().setOutputDeviceId(deviceId);
  }

  setInputVolume(volume: number): void {
    useAudioDeviceStore.getState().setInputVolume(volume);
    optimizedVoiceService.setInputVolume(volume);
  }

  setOutputVolume(volume: number): void {
    useAudioDeviceStore.getState().setOutputVolume(volume);
    optimizedVoiceService.setOutputVolume(volume);
  }

  setInputMode(mode: 'voice-activity' | 'push-to-talk'): void {
    useVADSettingsStore.getState().setInputMode(mode);
    optimizedVoiceService.setInputMode(mode);
  }

  setVADSensitivity(value: number): void {
    useVADSettingsStore.getState().setVADSensitivity(value);
    optimizedVoiceService.setVADSensitivity(value);
  }

  setAutoDetectSensitivity(enabled: boolean): void {
    useVADSettingsStore.getState().setAutoDetectSensitivity(enabled);
    optimizedVoiceService.setAutoDetectSensitivity(enabled);
  }

  setPTTKey(key: string): void {
    useVADSettingsStore.getState().setPTTKey(key);
    optimizedVoiceService.setPTTKey(key);
  }

  setPTTDelay(delay: number): void {
    useVADSettingsStore.getState().setPTTDelay(delay);
    optimizedVoiceService.setPTTDelay(delay);
  }

  async setMuted(muted: boolean): Promise<void> {
    await optimizedVoiceService.setMuted(muted);
  }

  async setDeafened(deafened: boolean): Promise<void> {
    await optimizedVoiceService.setDeafened(deafened);
  }
}

export const voiceSettingsController = new VoiceSettingsController();
export default voiceSettingsController;
