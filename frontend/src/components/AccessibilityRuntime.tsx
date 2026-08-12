'use client'

import { useEffect } from 'react'
import {
  ZOOM_LEVELS,
  useAccessibilitySettingsStore,
} from '../store/accessibilitySettingsStore'

export function AccessibilityRuntime() {
  const settings = useAccessibilitySettingsStore()

  useEffect(() => {
    const root = document.documentElement
    root.dataset.interfaceDensity = settings.interfaceDensity
    root.dataset.messageDisplay = settings.messageDisplay
    root.dataset.underlineLinks = String(settings.underlineLinks)
    root.dataset.displayNameStyles = String(settings.displayNameStyles)
    root.style.setProperty('--miscord-chat-font-size', `${settings.chatFontSize}px`)
    root.style.setProperty('--miscord-message-group-spacing', `${settings.messageGroupSpacing}px`)
    document.body.style.zoom = `${settings.zoomLevel / 100}`
  }, [settings.chatFontSize, settings.displayNameStyles, settings.interfaceDensity,
    settings.messageDisplay, settings.messageGroupSpacing, settings.underlineLinks,
    settings.zoomLevel])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const direction = event.code === 'Equal' || event.code === 'NumpadAdd'
        ? 1
        : event.code === 'Minus' || event.code === 'NumpadSubtract'
          ? -1
          : 0
      if (direction === 0 && event.code !== 'Digit0' && event.code !== 'Numpad0') return
      event.preventDefault()
      const state = useAccessibilitySettingsStore.getState()
      if (direction === 0) {
        state.setZoomLevel(100)
        return
      }
      const currentIndex = ZOOM_LEVELS.indexOf(state.zoomLevel as typeof ZOOM_LEVELS[number])
      const start = currentIndex >= 0 ? currentIndex : ZOOM_LEVELS.indexOf(100)
      const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, start + direction))
      state.setZoomLevel(ZOOM_LEVELS[next])
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return null
}
