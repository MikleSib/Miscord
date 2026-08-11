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

export function MobileExperience() {
  const initializedRef = useRef(false)
  const previousServerRef = useRef<number | null>(null)
  const previousChannelRef = useRef<string | null>(null)
  const [mounted, setMounted] = useState(false)
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
    const handlePopState = (event: PopStateEvent) => {
      const snapshot = event.state?.[HISTORY_KEY]
      if (isMobileNavigationSnapshot(snapshot)) {
        useMobileNavigationStore.getState().applySnapshot(snapshot)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [isNarrow])

  const goBack = () => {
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
      {isNarrow && navigation.pane === 'chat' && (
        <button type="button" className="miscord-mobile-back" onClick={goBack} aria-label="Назад">
          <ChevronLeft aria-hidden="true" />
        </button>
      )}

      {isNarrow && currentServer && navigation.pane === 'chat' && !navigation.memberDrawerOpen && (
        <button
          type="button"
          className="miscord-mobile-members-button"
          onClick={() => commitNavigation({
            memberDrawerOpen: !useMobileNavigationStore.getState().memberDrawerOpen,
          }, 'replace')}
          aria-label="Участники канала"
          aria-expanded="false"
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
