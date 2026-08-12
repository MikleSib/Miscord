import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type InterfaceDensity = 'compact' | 'default' | 'spacious'
export type MessageDisplay = 'default' | 'compact'

export interface AccessibilitySettingsState {
  chatFontSize: number
  underlineLinks: boolean
  displayNameStyles: boolean
  interfaceDensity: InterfaceDensity
  messageDisplay: MessageDisplay
  messageGroupSpacing: number
  zoomLevel: number
  setChatFontSize: (value: number) => void
  setUnderlineLinks: (value: boolean) => void
  setDisplayNameStyles: (value: boolean) => void
  setInterfaceDensity: (value: InterfaceDensity) => void
  setMessageDisplay: (value: MessageDisplay) => void
  setMessageGroupSpacing: (value: number) => void
  setZoomLevel: (value: number) => void
}

export const CHAT_FONT_SIZES = [12, 14, 15, 16, 18, 20, 24] as const
export const MESSAGE_GROUP_SPACING = [0, 4, 8, 16, 24] as const
export const ZOOM_LEVELS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const

function nearest(value: number, allowed: readonly number[]): number {
  return allowed.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best,
  )
}

export const useAccessibilitySettingsStore = create<AccessibilitySettingsState>()(
  persist(
    (set) => ({
      chatFontSize: 16,
      underlineLinks: false,
      displayNameStyles: true,
      interfaceDensity: 'default',
      messageDisplay: 'default',
      messageGroupSpacing: 16,
      zoomLevel: 100,
      setChatFontSize: (value) => set({ chatFontSize: nearest(value, CHAT_FONT_SIZES) }),
      setUnderlineLinks: (underlineLinks) => set({ underlineLinks }),
      setDisplayNameStyles: (displayNameStyles) => set({ displayNameStyles }),
      setInterfaceDensity: (interfaceDensity) => set({ interfaceDensity }),
      setMessageDisplay: (messageDisplay) => set({ messageDisplay }),
      setMessageGroupSpacing: (value) => set({ messageGroupSpacing: nearest(value, MESSAGE_GROUP_SPACING) }),
      setZoomLevel: (value) => set({ zoomLevel: nearest(value, ZOOM_LEVELS) }),
    }),
    { name: 'miscord-accessibility-settings', version: 1 },
  ),
)
