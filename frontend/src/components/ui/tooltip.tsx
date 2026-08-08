'use client'

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipProps {
  content: React.ReactNode
  side?: TooltipSide
  /** Не показывать подсказку (например, пока открыт попап) */
  disabled?: boolean
  className?: string
  contentClassName?: string
  children: React.ReactNode
}

const SHOW_DELAY_MS = 350

/**
 * Фирменная подсказка через portal — не обрезается overflow родителей.
 */
export function Tooltip({
  content,
  side = 'top',
  disabled = false,
  className,
  contentClassName,
  children,
}: TooltipProps) {
  const id = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const showTimerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [positioned, setPositioned] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })

  const clearShowTimer = () => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const tooltip = tooltipRef.current
    if (!trigger || !tooltip) return

    const rect = trigger.getBoundingClientRect()
    const tipRect = tooltip.getBoundingClientRect()
    const gap = 8

    let top = 0
    let left = 0

    switch (side) {
      case 'top':
        top = rect.top - tipRect.height - gap
        left = rect.left + rect.width / 2 - tipRect.width / 2
        break
      case 'bottom':
        top = rect.bottom + gap
        left = rect.left + rect.width / 2 - tipRect.width / 2
        break
      case 'left':
        top = rect.top + rect.height / 2 - tipRect.height / 2
        left = rect.left - tipRect.width - gap
        break
      case 'right':
        top = rect.top + rect.height / 2 - tipRect.height / 2
        left = rect.right + gap
        break
    }

    const pad = 8
    left = Math.max(pad, Math.min(left, window.innerWidth - tipRect.width - pad))
    top = Math.max(pad, Math.min(top, window.innerHeight - tipRect.height - pad))

    setCoords({ top, left })
    setPositioned(true)
  }, [side])

  const scheduleOpen = () => {
    clearShowTimer()
    showTimerRef.current = window.setTimeout(() => {
      setOpen(true)
      setPositioned(false)
    }, SHOW_DELAY_MS)
  }

  const close = () => {
    clearShowTimer()
    setOpen(false)
    setPositioned(false)
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, content, side, updatePosition])

  useEffect(() => {
    if (!open) return

    const onLayoutChange = () => updatePosition()
    window.addEventListener('scroll', onLayoutChange, true)
    window.addEventListener('resize', onLayoutChange)

    return () => {
      window.removeEventListener('scroll', onLayoutChange, true)
      window.removeEventListener('resize', onLayoutChange)
    }
  }, [open, updatePosition])

  useEffect(() => () => clearShowTimer(), [])

  if (disabled || content == null || content === '') {
    return <>{children}</>
  }

  return (
    <>
      <span
        ref={triggerRef}
        className={cn('miscord-tooltip-trigger', className)}
        onMouseEnter={scheduleOpen}
        onMouseLeave={close}
        onFocus={scheduleOpen}
        onBlur={close}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            ref={tooltipRef}
            id={id}
            role="tooltip"
            className={cn(
              'miscord-tooltip miscord-tooltip--portal',
              `miscord-tooltip--${side}`,
              positioned && 'is-positioned',
              contentClassName
            )}
            style={{ top: coords.top, left: coords.left }}
          >
            {content}
          </span>,
          document.body
        )}
    </>
  )
}
