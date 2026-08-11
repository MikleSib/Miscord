'use client'

import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
const modalStack: HTMLElement[] = []

export function useModalFocusTrap<T extends HTMLElement>(open: boolean, onEscape: () => void) {
  const panelRef = useRef<T>(null)
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    if (panel) modalStack.push(panel)
    const focusables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE)
    window.requestAnimationFrame(() => (focusables?.[0] ?? panel)?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!panel || modalStack[modalStack.length - 1] !== panel) return
      if (event.key === 'Escape') {
        event.preventDefault()
        escapeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => !node.hasAttribute('disabled') && node.tabIndex !== -1,
      )
      if (!nodes.length) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (panel) {
        const stackIndex = modalStack.lastIndexOf(panel)
        if (stackIndex >= 0) modalStack.splice(stackIndex, 1)
      }
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [open])

  return panelRef
}
