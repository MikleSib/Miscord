import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useNoiseSuppressionStore } from './noiseSuppressionStore';
import {
  DEFAULT_CUSTOM_PROCESSING,
  migrateLegacyProfile,
  type VoiceProcessingProfile,
  type VoiceProcessingSettings,
} from '../services/voiceSettingsLogic';

interface VoiceProcessingSettingsState {
  profile: VoiceProcessingProfile;
  customSettings: VoiceProcessingSettings;
  setProfile: (profile: VoiceProcessingProfile) => void;
  updateCustomSettings: (settings: Partial<VoiceProcessingSettings>) => void;
}

const legacyNoiseSettings = useNoiseSuppressionStore.getState();

export const useVoiceProcessingSettingsStore = create<VoiceProcessingSettingsState>()(
  persist(
    (set) => ({
      profile: migrateLegacyProfile(
        legacyNoiseSettings.enabled,
        legacyNoiseSettings.engine,
      ),
      customSettings: {
        ...DEFAULT_CUSTOM_PROCESSING,
        noiseSuppression: legacyNoiseSettings.enabled,
        noiseSuppressionEngine: legacyNoiseSettings.engine,
      },
      setProfile: (profile) => set({ profile }),
      updateCustomSettings: (settings) =>
        set((state) => ({
          profile: 'custom',
          customSettings: { ...state.customSettings, ...settings },
        })),
    }),
    {
      name: 'miscord-voice-processing-v1',
      version: 1,
      partialize: (state) => ({
        profile: state.profile,
        customSettings: state.customSettings,
      }),
    },
  ),
);
