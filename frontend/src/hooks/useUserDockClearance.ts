'use client'

import { useEffect, useRef } from 'react'

const DOCK_HEIGHT_PROPERTY = '--user-dock-height'

export function useUserDockClearance() {
  const dockRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dock = dockRef.current
    const appShell = dock?.closest<HTMLElement>('.miscord-responsive-root')
    if (!dock || !appShell) return

    const updateClearance = () => {
      const height = Math.ceil(dock.getBoundingClientRect().height)
      if (height > 0) {
        appShell.style.setProperty(DOCK_HEIGHT_PROPERTY, `${height}px`)
      } else {
        appShell.style.removeProperty(DOCK_HEIGHT_PROPERTY)
      }
    }

    updateClearance()
    window.addEventListener('resize', updateClearance)

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateClearance)
    observer?.observe(dock)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateClearance)
      appShell.style.removeProperty(DOCK_HEIGHT_PROPERTY)
    }
  }, [])

  return dockRef
}
