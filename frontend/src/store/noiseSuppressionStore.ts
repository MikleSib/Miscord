import { create } from 'zustand';
import voiceService from '../services/voiceService';
import advancedNoiseSuppressionService from '../services/advancedNoiseSuppressionService';

export type NoiseSuppressionLevel = 'basic' | 'advanced' | 'professional';
export type AdvancedMode = 'gentle' | 'balanced' | 'aggressive';

interface NoiseSuppressionState {
  // Common settings
  isEnabled: boolean;
  level: NoiseSuppressionLevel;

  // Basic RNNoise settings
  vadEnabled: boolean;
  sensitivity: number; // 0-100

  // Advanced AI settings
  advancedMode: AdvancedMode;

  // Status and Statistics
  support: {
    basic: boolean;
    advanced: boolean; // RNNoise
    professional: boolean; // AI
  };
  stats: {
    processedFrames: number;
    processingTimeMs: number;
    quality: number; // 0-1
  };

  // Actions
  initialize: () => void;
  setEnabled: (enabled: boolean) => void;
  setLevel: (level: NoiseSuppressionLevel) => void;
  setVadEnabled: (enabled: boolean) => void;
  setSensitivity: (sensitivity: number) => void;
  setAdvancedMode: (mode: AdvancedMode) => void;
  updateStats: () => void;
}

export const useNoiseSuppressionStore = create<NoiseSuppressionState>((set, get) => ({
  // Initial state
  isEnabled: true,
  level: 'professional',
  vadEnabled: true,
  sensitivity: 85,
  advancedMode: 'balanced',

  support: {
    basic: false,
    advanced: false,
    professional: false,
  },
  stats: {
    processedFrames: 0,
    processingTimeMs: 0,
    quality: 1,
  },

  // Actions
  initialize: () => {
    try {
      const supportInfo = voiceService.isNoiseSuppressionSupported();
      const advancedSupport = advancedNoiseSuppressionService.isSupported();
      set({
        support: {
          basic: supportInfo.basic,
          advanced: supportInfo.advanced,
          professional: advancedSupport
        }
      });
      
      // Принудительно включаем шумодав при инициализации
      const currentState = get();
      if (!currentState.isEnabled) {
        console.log('🔇 Store: Принудительно включаем шумодав при инициализации');
        get().setEnabled(true);
      } else {
        // Устанавливаем настройки в сервисы
        get().setEnabled(true);
        get().setLevel(currentState.level);
      }

    } catch (error) {
      console.error("Failed to initialize noise suppression store:", error);
    }
  },

  setEnabled: (enabled) => {
    const { level } = get();
    if (level === 'professional') {
      advancedNoiseSuppressionService.setEnabled(enabled);
    } else {
      voiceService.setNoiseSuppressionEnabled(enabled);
    }
    set({ isEnabled: enabled });
  },

  setLevel: (level) => {
    const { isEnabled } = get();
    set({ level });
    // When switching levels, ensure the correct service is activated/deactivated
    if (level === 'professional') {
      voiceService.setNoiseSuppressionEnabled(false);
      advancedNoiseSuppressionService.setEnabled(isEnabled);
      advancedNoiseSuppressionService.setMode(get().advancedMode);
    } else {
      advancedNoiseSuppressionService.setEnabled(false);
      voiceService.setNoiseSuppressionEnabled(isEnabled);
      voiceService.setNoiseSuppressionLevel(level);
    }
  },

  setVadEnabled: (enabled) => {
    voiceService.setVadEnabled(enabled);
    set({ vadEnabled: enabled });
  },

  setSensitivity: (sensitivity) => {
    const { level } = get();
    if (level === 'professional') {
      advancedNoiseSuppressionService.setSensitivity(sensitivity);
    } else {
      voiceService.setNoiseSuppressionSensitivity(sensitivity);
    }
    set({ sensitivity });
  },

  setAdvancedMode: (mode) => {
    advancedNoiseSuppressionService.setMode(mode);
    set({ advancedMode: mode });
  },

  updateStats: () => {
    const { level, isEnabled } = get();
    let newStats = { processedFrames: 0, processingTimeMs: 0, quality: 0 };
    try {
        if (!isEnabled) {
          set({ stats: newStats });
          return;
        }

        if (level === 'professional') {
            const advancedStats = advancedNoiseSuppressionService.getStats();
            newStats = { 
                processedFrames: advancedStats?.processedFrames || 0,
                // processingTimeMs is not available in this service's stats
                processingTimeMs: 0, 
                quality: advancedNoiseSuppressionService.getRealtimeQuality() 
            };
        } else {
            const basicStats = voiceService.getNoiseSuppressionStats();
            // The basic service does not provide detailed stats.
            newStats = {
                processedFrames: 0,
                processingTimeMs: 0,
                quality: basicStats.rnnoiseLoaded ? 0.8 : 0.6
            };
        }
    } catch(e) {
        console.error("Failed to update stats:", e);
    }

    set({ stats: newStats });
  },
}));

// Auto-update stats every few seconds
setInterval(() => {
  useNoiseSuppressionStore.getState().updateStats();
}, 2000);

// Initialize the store
useNoiseSuppressionStore.getState().initialize(); 