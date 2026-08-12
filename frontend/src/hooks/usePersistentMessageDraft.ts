import { Dispatch, SetStateAction, useEffect, useRef } from 'react'

import { messageStateService } from '../services/messageStateService'


export function usePersistentMessageDraft(
  channelId: number | null,
  content: string,
  setContent: Dispatch<SetStateAction<string>>,
) {
  const hydratedChannel = useRef<number | null>(null)
  const saveTimer = useRef<number | null>(null)
  const latestContent = useRef(content)
  latestContent.current = content

  useEffect(() => {
    if (!channelId) return
    let active = true
    hydratedChannel.current = null
    setContent('')
    void messageStateService.listDrafts().then((drafts) => {
      if (!active) return
      const draft = drafts.find((item) => item.channel_id === channelId)
      setContent((current) => current || draft?.content || '')
      hydratedChannel.current = channelId
    }).catch(() => {
      if (active) hydratedChannel.current = channelId
    })
    return () => {
      active = false
      const previous = latestContent.current
      const request = previous.trim()
        ? messageStateService.saveDraft(channelId, previous)
        : messageStateService.deleteDraft(channelId)
      void request.catch(() => undefined)
    }
  }, [channelId, setContent])

  useEffect(() => {
    if (!channelId || hydratedChannel.current !== channelId) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const request = content.trim()
        ? messageStateService.saveDraft(channelId, content)
        : messageStateService.deleteDraft(channelId)
      void request.catch(() => undefined)
    }, 650)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [channelId, content])
}
