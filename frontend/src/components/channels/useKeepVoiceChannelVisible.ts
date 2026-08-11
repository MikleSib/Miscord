'use client'

import { RefObject, useEffect } from 'react'

type Rect = Pick<DOMRect, 'top' | 'bottom'>

const EDGE_GAP = 12

export function getVoiceChannelScrollDelta(
  scroller: Rect,
  channel: Rect,
  dockTop: number | null,
  gap = EDGE_GAP,
) {
  const visibleTop = scroller.top + gap
  const visibleBottom = Math.min(scroller.bottom - gap, (dockTop ?? scroller.bottom) - gap)

  if (channel.top < visibleTop) return channel.top - visibleTop
  if (channel.bottom > visibleBottom) return channel.bottom - visibleBottom
  return 0
}

export function useKeepVoiceChannelVisible(
  scrollRef: RefObject<HTMLDivElement | null>,
  currentVoiceChannelId: number | null,
) {
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || currentVoiceChannelId == null) return

    let frame = 0
    let mutationObserver: MutationObserver | null = null

    const revealChannel = () => {
      const channel = scroller.querySelector<HTMLElement>(
        `[data-voice-channel-id="${currentVoiceChannelId}"]`,
      )
      if (!channel) return false

      const scrollerRect = scroller.getBoundingClientRect()
      const channelRect = channel.getBoundingClientRect()
      const dock = document.querySelector<HTMLElement>('.user-dock')
      const dockRect = dock?.getBoundingClientRect()
      const dockOverlapsSidebar = Boolean(
        dockRect &&
        dockRect.height > 0 &&
        dockRect.right > scrollerRect.left &&
        dockRect.left < scrollerRect.right &&
        dockRect.top < scrollerRect.bottom,
      )
      const delta = getVoiceChannelScrollDelta(
        scrollerRect,
        channelRect,
        dockOverlapsSidebar && dockRect ? dockRect.top : null,
      )

      if (Math.abs(delta) > 1) {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        scroller.scrollBy({ top: delta, behavior: reducedMotion ? 'auto' : 'smooth' })
      }
      return true
    }

    const scheduleReveal = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => revealChannel())
    }

    if (!revealChannel()) {
      mutationObserver = new MutationObserver(() => {
        if (revealChannel()) mutationObserver?.disconnect()
      })
      mutationObserver.observe(scroller, { childList: true, subtree: true })
    }

    const dock = document.querySelector<HTMLElement>('.user-dock')
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleReveal)
    if (dock) resizeObserver?.observe(dock)

    window.addEventListener('resize', scheduleReveal)
    return () => {
      window.cancelAnimationFrame(frame)
      mutationObserver?.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleReveal)
    }
  }, [currentVoiceChannelId, scrollRef])
}
