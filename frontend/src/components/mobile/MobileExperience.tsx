'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  Headphones,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  Users,
  VolumeX,
} from 'lucide-react'
import { useStore } from '../../lib/store'
import { useOptimizedVoiceStore } from '../../store/slices/optimizedVoiceSlice'
import {
  isMobileNavigationSnapshot,
  MobileNavigationSnapshot,
  useMobileNavigationStore,
} from '../../store/mobileNavigationStore'
import { useResponsiveLayout, useVisualViewportVariables } from '../../hooks/useResponsiveLayout'

const HISTORY_KEY = 'miscordMobileNavigation'

function snapshotFromState(): MobileNavigationSnapshot {
  const state = useMobileNavigationStore.getState()
  return {
    rootTab: state.rootTab,
    pane: state.pane,
    channelDrawerOpen: state.channelDrawerOpen,
    memberDrawerOpen: state.memberDrawerOpen,
    homeDetailOpen: state.homeDetailOpen,
  }
}

export function MobileExperience() {
  const initializedRef = useRef(false)
  const previousServerRef = useRef<number | null>(null)
  const previousChannelRef = useRef<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [settingsDetailOpen, setSettingsDetailOpen] = useState(false)
  const viewport = useResponsiveLayout()
  const isNarrow = viewport === 'phone' || viewport === 'tablet'
  useVisualViewportVariables()

  const currentServer = useStore((state) => state.currentServer)
  const currentChannel = useStore((state) => state.currentChannel)

  const navigation = useMobileNavigationStore()
  const voice = useOptimizedVoiceStore() as unknown as {
    isConnected: boolean
    isConnecting: boolean
    currentVoiceChannelId: number | null
    participants: Array<{ user_id: number; username: string; display_name?: string | null }>
    isMuted?: boolean
    isDeafened?: boolean
    toggleMute?: () => void
    toggleDeafen?: () => void
    disconnectFromVoiceChannel: () => void
  }

  const commitNavigation = useCallback(
    (next: Partial<MobileNavigationSnapshot>, mode: 'push' | 'replace' = 'push') => {
      const snapshot = useMobileNavigationStore.getState().navigate(next)
      if (!isNarrow) return snapshot
      const historyState = { ...window.history.state, [HISTORY_KEY]: snapshot }
      if (mode === 'replace') window.history.replaceState(historyState, '')
      else window.history.pushState(historyState, '')
      return snapshot
    },
    [isNarrow],
  )

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const html = document.documentElement
    html.dataset.miscordViewport = viewport
    html.dataset.miscordPane = navigation.pane
    html.dataset.miscordContext = currentServer ? 'server' : 'home'
    html.dataset.miscordMembers = navigation.memberDrawerOpen ? 'open' : 'closed'
    html.dataset.miscordHomeDetail = navigation.homeDetailOpen ? 'open' : 'closed'
    return () => {
      delete html.dataset.miscordViewport
      delete html.dataset.miscordPane
      delete html.dataset.miscordContext
      delete html.dataset.miscordMembers
      delete html.dataset.miscordHomeDetail
    }
  }, [currentServer, navigation.homeDetailOpen, navigation.memberDrawerOpen, navigation.pane, viewport])

  useEffect(() => {
    const decorateModals = () => {
      document.querySelectorAll<HTMLElement>('.fixed.inset-0, [role="dialog"]').forEach((overlay) => {
        if (overlay.id === 'screen-share-overlay' || overlay.classList.contains('screen-share-viewer')) return
        overlay.classList.add('miscord-responsive-modal')
        const card = overlay.firstElementChild as HTMLElement | null
        card?.classList.add('miscord-responsive-modal-card')
        const sidebar = overlay.querySelector<HTMLElement>(
          '.w-64, .w-60, .w-\\[200px\\], .w-\\[218px\\], .w-\\[220px\\]',
        )
        if (!sidebar) return
        overlay.classList.add('miscord-settings-dialog')
        sidebar.classList.add('miscord-settings-sidebar')
        const detail = sidebar.nextElementSibling as HTMLElement | null
        detail?.classList.add('miscord-settings-detail')
      })
    }

    decorateModals()
    const observer = new MutationObserver(decorateModals)
    observer.observe(document.body, { childList: true, subtree: true })

    const handleSettingsClick = (event: MouseEvent) => {
      if (!isNarrow) return
      const target = event.target as HTMLElement | null
      const sidebar = target?.closest('.miscord-settings-sidebar')
      const action = target?.closest('button, a, [role="button"]')
      if (!sidebar || !action) return
      const modal = sidebar.closest<HTMLElement>('.miscord-settings-dialog')
      if (!modal) return
      modal.dataset.mobileDetail = 'open'
      setSettingsDetailOpen(true)
      window.history.pushState(
        { ...window.history.state, miscordSettingsDetail: true, [HISTORY_KEY]: snapshotFromState() },
        '',
      )
    }

    document.addEventListener('click', handleSettingsClick)
    return () => {
      observer.disconnect()
      document.removeEventListener('click', handleSettingsClick)
    }
  }, [isNarrow])

  useEffect(() => {
    if (!isNarrow || initializedRef.current) return
    initializedRef.current = true
    previousServerRef.current = currentServer?.id ?? null
    previousChannelRef.current = currentChannel ? `${currentChannel.type}:${currentChannel.id}` : null

    const initial: Partial<MobileNavigationSnapshot> = currentServer
      ? { rootTab: 'servers', pane: currentChannel?.type === 'text' ? 'chat' : 'channels' }
      : { rootTab: 'messages', pane: 'root', homeDetailOpen: false }
    commitNavigation(initial, 'replace')
  }, [commitNavigation, currentChannel, currentServer, isNarrow])

  useEffect(() => {
    if (!isNarrow || !initializedRef.current) return
    const nextServerId = currentServer?.id ?? null
    if (previousServerRef.current === nextServerId) return
    previousServerRef.current = nextServerId
    const selectedChannel = useStore.getState().currentChannel
    previousChannelRef.current = selectedChannel ? `${selectedChannel.type}:${selectedChannel.id}` : null
    commitNavigation(
      nextServerId
        ? { rootTab: 'servers', pane: 'channels', homeDetailOpen: false, memberDrawerOpen: false }
        : { rootTab: 'messages', pane: 'root', homeDetailOpen: false, memberDrawerOpen: false },
    )
  }, [commitNavigation, currentServer?.id, isNarrow])

  useEffect(() => {
    if (!isNarrow || !initializedRef.current || currentChannel?.type !== 'text') return
    const nextChannel = `${currentChannel.type}:${currentChannel.id}`
    if (previousChannelRef.current === nextChannel) return
    previousChannelRef.current = nextChannel
    commitNavigation({ pane: 'chat', channelDrawerOpen: false, memberDrawerOpen: false })
  }, [commitNavigation, currentChannel, isNarrow])

  useEffect(() => {
    const openDm = (event: Event) => {
      if (!isNarrow) return
      if (
        event.type === 'miscord:dm-opened' &&
        event instanceof CustomEvent &&
        event.detail?.open === false
      ) {
        commitNavigation(
          { rootTab: 'messages', pane: 'root', homeDetailOpen: false, memberDrawerOpen: false },
          'replace',
        )
        return
      }
      commitNavigation({ rootTab: 'messages', pane: 'chat', homeDetailOpen: true, memberDrawerOpen: false })
    }
    window.addEventListener('open_direct_message', openDm)
    window.addEventListener('miscord:dm-opened', openDm)
    return () => {
      window.removeEventListener('open_direct_message', openDm)
      window.removeEventListener('miscord:dm-opened', openDm)
    }
  }, [commitNavigation, isNarrow])

  useEffect(() => {
    if (!isNarrow) return
    const handleHomeClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const sidebar = target?.closest('.app-home-content > .app-sidebar')
      if (!sidebar || !target?.closest('button, a, [role="button"]')) return
      window.setTimeout(() => {
        commitNavigation({ rootTab: 'messages', pane: 'chat', homeDetailOpen: true })
      }, 0)
    }
    document.addEventListener('click', handleHomeClick)
    return () => document.removeEventListener('click', handleHomeClick)
  }, [commitNavigation, isNarrow])

  useEffect(() => {
    if (!isNarrow) return
    const handlePopState = (event: PopStateEvent) => {
      if (event.state?.miscordSettingsDetail) return
      const snapshot = event.state?.[HISTORY_KEY]
      if (isMobileNavigationSnapshot(snapshot)) {
        useMobileNavigationStore.getState().applySnapshot(snapshot)
      }
      document.querySelectorAll<HTMLElement>('.miscord-settings-dialog[data-mobile-detail="open"]').forEach((modal) => {
        delete modal.dataset.mobileDetail
      })
      setSettingsDetailOpen(false)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [isNarrow])

  const goBack = () => {
    if (settingsDetailOpen) {
      document.querySelectorAll<HTMLElement>('.miscord-settings-dialog[data-mobile-detail="open"]').forEach((modal) => {
        delete modal.dataset.mobileDetail
      })
      setSettingsDetailOpen(false)
      return
    }
    if (navigation.memberDrawerOpen) {
      commitNavigation({ memberDrawerOpen: false }, 'replace')
      return
    }
    if (navigation.pane === 'call') {
      commitNavigation({ pane: currentServer ? 'chat' : 'root' }, 'replace')
      return
    }
    if (!currentServer && navigation.homeDetailOpen) {
      commitNavigation({ pane: 'root', homeDetailOpen: false }, 'replace')
      return
    }
    if (currentServer && navigation.pane === 'chat') {
      commitNavigation({ pane: 'channels', memberDrawerOpen: false }, 'replace')
      return
    }
    if (currentServer && navigation.pane === 'channels') {
      commitNavigation({ pane: 'servers' }, 'replace')
    }
  }

  useEffect(() => {
    if (!isNarrow || navigation.pane !== 'chat') return

    let startX: number | null = null
    let startY: number | null = null

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || event.touches[0].clientX > 32) return
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (startX === null || startY === null || event.changedTouches.length !== 1) return
      const deltaX = event.changedTouches[0].clientX - startX
      const deltaY = Math.abs(event.changedTouches[0].clientY - startY)
      startX = null
      startY = null
      if (deltaX < 72 || deltaX <= deltaY * 1.25) return
      if (navigation.memberDrawerOpen) {
        commitNavigation({ memberDrawerOpen: false }, 'replace')
      } else if (currentServer) {
        commitNavigation({ pane: 'channels', memberDrawerOpen: false }, 'replace')
      } else {
        commitNavigation({ pane: 'root', homeDetailOpen: false }, 'replace')
      }
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [commitNavigation, currentServer, isNarrow, navigation.memberDrawerOpen, navigation.pane])

  const voiceChannel = currentServer?.channels.find(
    (channel) => channel.id === voice.currentVoiceChannelId && channel.type === 'voice',
  )

  const mobileLayer = (
    <div className="miscord-mobile-layer" aria-live="polite">
      {isNarrow && (navigation.pane === 'chat' || settingsDetailOpen) && (
        <button type="button" className="miscord-mobile-back" onClick={goBack} aria-label="Назад">
          <ChevronLeft aria-hidden="true" />
        </button>
      )}

      {isNarrow && currentServer && navigation.pane === 'chat' && (
        <button
          type="button"
          className="miscord-mobile-members-button"
          onClick={() => commitNavigation({ memberDrawerOpen: true })}
          aria-label="Участники канала"
        >
          <Users aria-hidden="true" />
        </button>
      )}

      {isNarrow && navigation.memberDrawerOpen && (
        <button
          type="button"
          className="miscord-mobile-backdrop"
          onClick={() => commitNavigation({ memberDrawerOpen: false }, 'replace')}
          aria-label="Закрыть список участников"
        />
      )}

      {isNarrow && (voice.isConnected || voice.isConnecting) && navigation.pane !== 'call' && (
        <div className="miscord-mobile-voice-bar">
          <button
            type="button"
            className="miscord-mobile-voice-summary"
            onClick={() => commitNavigation({ pane: 'call', memberDrawerOpen: false })}
          >
            <span className={voice.isConnected ? 'is-connected' : 'is-connecting'} />
            <span>
              <strong>{voiceChannel?.name ?? 'Голосовой канал'}</strong>
              <small>{voice.isConnected ? 'Голосовая связь подключена' : 'Подключение...'}</small>
            </span>
          </button>
          {voice.toggleMute && (
            <button type="button" onClick={voice.toggleMute} aria-label={voice.isMuted ? 'Включить микрофон' : 'Выключить микрофон'}>
              {voice.isMuted ? <MicOff /> : <Mic />}
            </button>
          )}
          <button type="button" onClick={voice.disconnectFromVoiceChannel} aria-label="Отключиться">
            <PhoneOff />
          </button>
        </div>
      )}

      {isNarrow && navigation.pane === 'call' && (
        <section className="miscord-mobile-call" aria-label="Голосовой канал">
          <header>
            <div>
              <small>Голосовой канал</small>
              <h2>{voiceChannel?.name ?? 'Разговор'}</h2>
            </div>
            <button type="button" onClick={goBack} aria-label="Свернуть звонок">
              <Minimize2 />
            </button>
          </header>
          <div className="miscord-mobile-call-grid">
            {voice.participants.length ? (
              voice.participants.map((participant) => (
                <article key={participant.user_id}>
                  <div>{(participant.display_name || participant.username || '?').slice(0, 1).toUpperCase()}</div>
                  <span>{participant.display_name || participant.username}</span>
                </article>
              ))
            ) : (
              <p>Ожидаем участников...</p>
            )}
          </div>
          <footer>
            {voice.toggleMute && (
              <button type="button" onClick={voice.toggleMute} className={voice.isMuted ? 'is-danger' : ''} aria-label="Микрофон">
                {voice.isMuted ? <MicOff /> : <Mic />}
              </button>
            )}
            {voice.toggleDeafen && (
              <button type="button" onClick={voice.toggleDeafen} className={voice.isDeafened ? 'is-danger' : ''} aria-label="Звук">
                {voice.isDeafened ? <VolumeX /> : <Headphones />}
              </button>
            )}
            <button type="button" onClick={voice.disconnectFromVoiceChannel} className="is-hangup" aria-label="Завершить">
              <PhoneOff />
            </button>
          </footer>
        </section>
      )}

    </div>
  )

  return (
    <>
      {mounted ? createPortal(mobileLayer, document.body) : null}
    </>
  )
}
