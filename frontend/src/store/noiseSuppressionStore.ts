import { create } from 'zustand';
import noiseSuppressionService, { NoiseSuppressionSettings } from '../services/noiseSuppressionService';

interface NoiseSuppressionState {
  isEnabled: boolean;
  settings: NoiseSuppressionSettings;
  stats: {
    processedFrames: number;
    quality: number;
  };
  isSupported: boolean;
  initialize: () => void;
  setEnabled: (enabled: boolean) => void;
  setMode: (mode: NoiseSuppressionSettings['mode']) => void;
  setSensitivity: (sensitivity: number) => void;
  updateStats: () => void;
}

export const useNoiseSuppressionStore = create<NoiseSuppressionState>((set, get) => ({
  isEnabled: true,
  settings: noiseSuppressionService.getSettings(),
  stats: {
    processedFrames: 0,
    quality: 0,
  },
  isSupported: false,

  initialize: () => {
    const isSupported = noiseSuppressionService.isSupported();
    set({ 
      isSupported,
      settings: noiseSuppressionService.getSettings(),
      isEnabled: noiseSuppressionService.getSettings().enabled
    });
    
    // Запускаем обновление статистики, только если шумодав поддерживается
    if (isSupported) {
      setInterval(() => get().updateStats(), 1000);
    }
  },

  setEnabled: (enabled) => {
    noiseSuppressionService.setEnabled(enabled);
    set({ isEnabled: enabled });
    // Это вызовет обновление потока в voiceService
    window.dispatchEvent(new CustomEvent('noise-suppression-settings-changed'));
  },

  setMode: (mode) => {
    noiseSuppressionService.setMode(mode);
    set(state => ({ settings: { ...state.settings, mode } }));
  },

  setSensitivity: (sensitivity) => {
    noiseSuppressionService.setSensitivity(sensitivity);
    set(state => ({ settings: { ...state.settings, sensitivity } }));
  },

  updateStats: () => {
    const stats = noiseSuppressionService.getStats();
    const quality = noiseSuppressionService.getRealtimeQuality();
    set({
      stats: {
        processedFrames: stats?.processedFrames || 0,
        quality: quality,
      },
    });
  },
}));

if (typeof window !== 'undefined') {
  useNoiseSuppressionStore.getState().initialize();
} 