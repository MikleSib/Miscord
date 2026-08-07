import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  StreamFps,
  StreamPreset,
  StreamQualitySettings,
  StreamResolution,
} from '../lib/screenShareQuality';

interface ScreenShareSettingsState extends StreamQualitySettings {
  setPreset: (preset: StreamPreset) => void;
  setResolution: (resolution: StreamResolution) => void;
  setFps: (fps: StreamFps) => void;
  setMuteStreamAudio: (muteStreamAudio: boolean) => void;
}

export const useScreenShareSettingsStore = create<ScreenShareSettingsState>()(
  persist(
    (set) => ({
      preset: 'games',
      resolution: '1080',
      fps: 30,
      muteStreamAudio: false,
      setPreset: (preset) => set({ preset }),
      setResolution: (resolution) => set({ resolution, preset: 'custom' }),
      setFps: (fps) => set({ fps, preset: 'custom' }),
      setMuteStreamAudio: (muteStreamAudio) => set({ muteStreamAudio }),
    }),
    { name: 'miscord-screen-share-settings' }
  )
);
