'use client'

import { useCommunityStore } from '../../store/communityStore'
import { ThreadDialog } from './ThreadDialog'

export function ThreadDialogHost() {
  const draft = useCommunityStore((state) => state.threadDraft)
  const close = useCommunityStore((state) => state.closeThreadDraft)
  if (!draft) return null
  return <ThreadDialog open channelId={draft.channelId} sourceMessage={draft.message} onClose={close} />
}
