'use client'

import { useCallback, useEffect, useState } from 'react'

const COMPACT_SETTINGS_QUERY = '(max-width: 1023px)'
const HISTORY_FLAG = 'miscordSettingsDetail'

function isCompactSettingsViewport() {
  return typeof window !== 'undefined' && window.matchMedia(COMPACT_SETTINGS_QUERY).matches
}

export function useMobileSettingsDetail(open: boolean, openInitialDetail = false) {
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      setDetailOpen(false)
      return
    }
    setDetailOpen(openInitialDetail && isCompactSettingsViewport())
  }, [open, openInitialDetail])

  useEffect(() => {
    if (!open) return
    const closeOnHistoryBack = () => setDetailOpen(false)
    window.addEventListener('popstate', closeOnHistoryBack)
    return () => window.removeEventListener('popstate', closeOnHistoryBack)
  }, [open])

  const openDetail = useCallback(() => {
    if (!isCompactSettingsViewport()) return
    setDetailOpen(true)
    if (!window.history.state?.[HISTORY_FLAG]) {
      window.history.pushState({ ...window.history.state, [HISTORY_FLAG]: true }, '')
    }
  }, [])

  const closeDetail = useCallback(() => {
    setDetailOpen(false)
    if (window.history.state?.[HISTORY_FLAG]) window.history.back()
  }, [])

  return {
    detailOpen,
    openDetail,
    closeDetail,
    mobileDetailAttribute: detailOpen ? 'open' : undefined,
  }
}
