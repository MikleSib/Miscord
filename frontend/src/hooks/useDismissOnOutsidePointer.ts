'use client'

import { RefObject, useEffect } from 'react'

export function useDismissOnOutsidePointer<T extends HTMLElement>(
  containerRef: RefObject<T>,
  open: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const container = containerRef.current
      if (!container || event.composedPath().includes(container)) return
      onDismiss()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [containerRef, onDismiss, open])
}
