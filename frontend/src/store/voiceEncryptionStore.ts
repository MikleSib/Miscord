import { create } from 'zustand';

type VoiceEncryptionState = {
  active: boolean;
  verificationCode: string | null;
  error: string | null;
  setActive(code?: string): void;
  setError(message: string): void;
  reset(): void;
};

export const useVoiceEncryptionStore = create<VoiceEncryptionState>((set) => ({
  active: false,
  verificationCode: null,
  error: null,
  setActive: (verificationCode) => set({ active: true, verificationCode: verificationCode ?? null, error: null }),
  setError: (error) => set({ active: false, verificationCode: null, error }),
  reset: () => set({ active: false, verificationCode: null, error: null }),
}));
