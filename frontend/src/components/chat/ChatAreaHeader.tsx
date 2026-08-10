'use client'

import { ChevronRight, Hash, Pin, Users } from 'lucide-react'
import { Tooltip } from '../ui/tooltip'
import { formatSlowModeLabel } from '../../lib/slowMode'
import { MessageSearchBox } from '../search/MessageSearchBox'
import { PinnedMessagesPanel } from '../pins/PinnedMessagesPanel'
import type { SearchResultMessage } from '../../services/searchService'
import type { Channel, Message } from '../../types'
import { ThreadLauncher } from '../community/ThreadLauncher'

interface ChatAreaHeaderProps {
  channel: Channel
  serverId: number | null
  showUserSidebar: boolean
  onToggleUserSidebar: () => void
  showPinnedPanel: boolean
  onTogglePinnedPanel: () => void
  onClosePinnedPanel: () => void
  pinnedMessages: Message[]
  canManagePins: boolean
  pinsError: string | null
  onUnpin: (messageId: number) => void
  onJumpToMessage: (messageId: number) => void
  onJumpToSearchResult: (message: SearchResultMessage) => void
}

export function ChatAreaHeader({
  channel,
  serverId,
  showUserSidebar,
  onToggleUserSidebar,
  showPinnedPanel,
  onTogglePinnedPanel,
  onClosePinnedPanel,
  pinnedMessages,
  canManagePins,
  pinsError,
  onUnpin,
  onJumpToMessage,
  onJumpToSearchResult,
}: ChatAreaHeaderProps) {
  const isTextChannel = channel.type === 'text'
  const slowMode = channel.slow_mode_seconds ?? 0

  return (
    <div className="app-header chat-area-header flex h-12 flex-shrink-0 items-center justify-between border-b px-4">
      <div className="chat-area-header__title flex min-w-0 items-center">
        <Hash className="mr-2 h-5 w-5 text-muted-foreground" />
        <span className="truncate font-semibold">{channel.name}</span>
        <ChevronRight
          className="mobile-channel-chevron ml-1 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        {isTextChannel && slowMode > 0 && (
          <span className="ml-3 rounded bg-primary/15 px-2 py-0.5 text-xs text-[#949cf7]">
            Медленный режим: {formatSlowModeLabel(slowMode)}
          </span>
        )}
      </div>

      <div className="chat-area-header__actions relative flex items-center space-x-2">
        {serverId != null && (
          <MessageSearchBox
            serverId={serverId}
            currentChannelId={isTextChannel ? channel.id : null}
            currentChannelName={channel.name}
            onJump={onJumpToSearchResult}
          />
        )}

        {isTextChannel && (
          <ThreadLauncher channelId={channel.id} />
        )}

        {isTextChannel && (
          <Tooltip content="Закреплённые сообщения">
            <button
              className="interactive-row flex items-center p-2 text-muted-foreground hover:text-foreground"
              onClick={onTogglePinnedPanel}
              aria-label="Закреплённые сообщения"
              aria-expanded={showPinnedPanel}
            >
              <Pin className="h-5 w-5" />
            </button>
          </Tooltip>
        )}

        <Tooltip
          content={showUserSidebar ? 'Скрыть список участников' : 'Показать список участников'}
        >
          <button
            className="interactive-row flex items-center p-2 text-muted-foreground hover:text-foreground"
            onClick={onToggleUserSidebar}
            aria-label={showUserSidebar ? 'Скрыть список участников' : 'Показать список участников'}
          >
            <Users className="h-6 w-6 text-muted-foreground" />
          </button>
        </Tooltip>

        {showPinnedPanel && isTextChannel && (
          <PinnedMessagesPanel
            messages={pinnedMessages}
            canManage={canManagePins}
            error={pinsError}
            onUnpin={onUnpin}
            onClose={onClosePinnedPanel}
            onJumpToMessage={onJumpToMessage}
          />
        )}
      </div>
    </div>
  )
}
