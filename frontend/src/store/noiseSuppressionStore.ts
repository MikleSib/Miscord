import { create } from 'zustand';
import noiseSuppressionService, { NoiseSuppressionSettings } from '../services/noiseSuppressionService';

interface NoiseSuppressionState {
  isEnabled: boolean;
  settings: NoiseSuppressionSettings;
  stats: {
    processedFrames: number;
    quality: number;
  };
  micLevel: number; // Уровень микрофона в дБ (-100 до 0)
  isSupported: boolean;
  initialize: () => void;
  setEnabled: (enabled: boolean) => void;
  setMode: (mode: NoiseSuppressionSettings['mode']) => void;
  setSensitivity: (sensitivity: number) => void;
  setVadThreshold: (threshold: number) => void;
  setMicLevel: (level: number) => void;
  updateStats: () => void;
}

export const useNoiseSuppressionStore = create<NoiseSuppressionState>((set, get) => ({
  isEnabled: true,
  settings: {
    enabled: true,
    sensitivity: 75,
    mode: 'balanced',
    vadEnabled: true,
    vadThreshold: -60,
    adaptiveThreshold: true,
    bandCount: 8,
    debugMode: false
  },
  stats: {
    processedFrames: 0,
    quality: 0,
  },
  micLevel: -100,
  isSupported: false,

  initialize: () => {
    if (typeof window === 'undefined') return;
    
    const isSupported = noiseSuppressionService.isSupported();
    const settings = noiseSuppressionService.getSettings();
    set({ 
      isSupported,
      settings,
      isEnabled: settings.enabled
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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('noise-suppression-settings-changed'));
    }
  },

  setMode: (mode) => {
    noiseSuppressionService.setMode(mode);
    set(state => ({ settings: { ...state.settings, mode } }));
  },

  setSensitivity: (sensitivity) => {
    noiseSuppressionService.setSensitivity(sensitivity);
    set(state => ({ settings: { ...state.settings, sensitivity } }));
  },

  setVadThreshold: (threshold) => {
    noiseSuppressionService.setVadThreshold(threshold);
    set(state => ({ settings: { ...state.settings, vadThreshold: threshold } }));
  },

  setMicLevel: (level) => {
    set({ micLevel: level });
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

// Инициализируем только на клиенте
if (typeof window !== 'undefined') {
  useNoiseSuppressionStore.getState().initialize();
} 