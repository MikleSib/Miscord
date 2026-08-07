'use client'

import { useEffect, useSyncExternalStore } from 'react'

export type AppViewport = 'phone' | 'tablet' | 'compact-desktop' | 'desktop'

function getViewport(): AppViewport {
  if (typeof window === 'undefined') return 'desktop'
  if (window.innerWidth < 768) return 'phone'
  if (window.innerWidth < 1024) return 'tablet'
  if (window.innerWidth < 1280) return 'compact-desktop'
  return 'desktop'
}

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange, { passive: true })
  window.addEventListener('orientationchange', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    window.removeEventListener('orientationchange', onChange)
  }
}

export function useResponsiveLayout(): AppViewport {
  return useSyncExternalStore(subscribe, getViewport, () => 'desktop')
}

export function useVisualViewportVariables() {
  useEffect(() => {
    const viewport = window.visualViewport

    const update = () => {
      const visibleHeight = Math.round(viewport?.height ?? window.innerHeight)
      const keyboardOffset = Math.max(
        0,
        Math.round(window.innerHeight - visibleHeight - (viewport?.offsetTop ?? 0)),
      )

      document.documentElement.style.setProperty('--app-visual-height', `${visibleHeight}px`)
      document.documentElement.style.setProperty('--mobile-keyboard-offset', `${keyboardOffset}px`)
      document.documentElement.dataset.mobileKeyboard = keyboardOffset > 80 ? 'open' : 'closed'
    }

    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update, { passive: true })

    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.documentElement.style.removeProperty('--app-visual-height')
      document.documentElement.style.removeProperty('--mobile-keyboard-offset')
      delete document.documentElement.dataset.mobileKeyboard
    }
  }, [])
}

