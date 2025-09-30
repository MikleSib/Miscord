import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VADSettingsState {
  // Режим ввода
  inputMode: 'voice-activity' | 'push-to-talk';
  
  // Настройки чувствительности VAD
  vadSensitivity: number; // 0-100, где 0 = максимально чувствительный, 100 = минимально
  autoDetectSensitivity: boolean;
  
  // Push-to-Talk настройки
  pttKey: string; // Клавиша для PTT (например, 'Space', 'ControlLeft')
  pttDelay: number; // Задержка перед отключением микрофона после отпускания (мс)
  isPTTActive: boolean; // Активна ли кнопка PTT в данный момент
  
  // Actions
  setInputMode: (mode: 'voice-activity' | 'push-to-talk') => void;
  setVADSensitivity: (sensitivity: number) => void;
  setAutoDetectSensitivity: (auto: boolean) => void;
  setPTTKey: (key: string) => void;
  setPTTDelay: (delay: number) => void;
  setPTTActive: (active: boolean) => void;
}

export const useVADSettingsStore = create<VADSettingsState>()(
  persist(
    (set) => ({
      // Начальные значения
      inputMode: 'voice-activity',
      vadSensitivity: 50, // Средняя чувствительность
      autoDetectSensitivity: true,
      pttKey: 'Space',
      pttDelay: 20,
      isPTTActive: false,
      
      // Actions
      setInputMode: (mode) => set({ inputMode: mode }),
      
      setVADSensitivity: (sensitivity) => 
        set({ vadSensitivity: Math.max(0, Math.min(100, sensitivity)) }),
      
      setAutoDetectSensitivity: (auto) => set({ autoDetectSensitivity: auto }),
      
      setPTTKey: (key) => set({ pttKey: key }),
      
      setPTTDelay: (delay) => 
        set({ pttDelay: Math.max(0, Math.min(2000, delay)) }),
      
      setPTTActive: (active) => set({ isPTTActive: active }),
    }),
    {
      name: 'vad-settings-storage',
      partialize: (state) => ({
        inputMode: state.inputMode,
        vadSensitivity: state.vadSensitivity,
        autoDetectSensitivity: state.autoDetectSensitivity,
        pttKey: state.pttKey,
        pttDelay: state.pttDelay,
      }),
    }
  )
);
