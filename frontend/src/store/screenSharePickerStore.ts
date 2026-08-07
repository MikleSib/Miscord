import { create } from 'zustand';

interface ScreenSharePickerState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useScreenSharePickerStore = create<ScreenSharePickerState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
