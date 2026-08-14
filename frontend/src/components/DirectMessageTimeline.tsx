'use client'

import { Clock3, Reply, Smile, Trash2 } from 'lucide-react'

import {
  formatDirectMessageDate,
  formatDirectMessageTime,
  isDirectMessageGroupStart,
  needsDirectMessageDateSeparator,
} from '../lib/directMessageTimeline'
import type { DirectMessage, User } from '../types'
import { EmojiPickerPopover } from './emoji/EmojiPickerPopover'
import { ManagedMessageAttachments } from './ManagedMessageAttachments'
import { MessageAttachmentGallery } from './MessageAttachmentGallery'
import { MessageMedia, RichMessageContent } from './media/MessageMedia'
import { MessageLinkEmbeds } from './MessageLinkEmbeds'
import { UserAvatar } from './ui/user-avatar'

interface DirectMessageTimelineProps {
  messages: DirectMessage[]
  currentUser?: User | null
  friend: User
  loading: boolean
  hasMore: boolean
  openActionsFor: number | string | null
  openEmojiFor: number | string | null
  onToggleActions: (messageId: number | string) => void
  onCloseActions: () => void
  onToggleEmoji: (messageId: number | string) => void
  onCloseEmoji: () => void
  onAddReaction: (messageId: number | string, emoji: string) => void
  onReply: (message: DirectMessage) => void
  onDelete: (messageId: number | string) => void
  canDelete: (message: DirectMessage) => boolean
  onOpenAttachment: (message: DirectMessage, url: string) => void
}

function userName(user?: User | null): string {
  return user?.display_name || user?.username || 'Пользователь'
}

export function DirectMessageTimeline({
  messages,
  currentUser,
  friend,
  loading,
  hasMore,
  openActionsFor,
  openEmojiFor,
  onToggleActions,
  onCloseActions,
  onToggleEmoji,
  onCloseEmoji,
  onAddReaction,
  onReply,
  onDelete,
  canDelete,
  onOpenAttachment,
}: DirectMessageTimelineProps) {
  const friendName = userName(friend)

  return (
    <div className="direct-message-timeline" role="log" aria-label={`Переписка с ${friendName}`}>
      {loading && hasMore && (
        <div className="direct-message-history-status" role="status">
          Загружаем предыдущие сообщения…
        </div>
      )}

      <section className="direct-message-intro" aria-label="Начало переписки">
        <UserAvatar user={friend} size={64} className="direct-message-intro__avatar" />
        <h2>{friendName}</h2>
        <p>@{friend.username}</p>
        <span className="direct-message-intro__summary">
          Это начало вашей личной переписки с @{friend.username}.
        </span>
      </section>

      {messages.map((message, index) => {
        const previous = messages[index - 1]
        const startsGroup = isDirectMessageGroupStart(message, previous)
        const hasDateSeparator = needsDirectMessageDateSeparator(message, previous)
        const author = message.sender_id === currentUser?.id ? currentUser : friend
        const actionMenuOpen = openActionsFor === message.id
        const pending = Boolean(message.isPending)

        return (
          <div key={message.id}>
            {hasDateSeparator && (
              <div className="date-divider" role="separator">
                <span>{formatDirectMessageDate(message.timestamp)}</span>
              </div>
            )}

            <article
              className={`direct-message-entry ${startsGroup ? 'is-group-start' : 'is-grouped'} ${actionMenuOpen ? 'is-actions-open' : ''}`}
              onMouseLeave={onCloseActions}
              onPointerUp={(event) => {
                if (event.pointerType === 'touch') onToggleActions(message.id)
              }}
            >
              <div className="direct-message-entry__avatar">
                {startsGroup ? (
                  <UserAvatar user={author || undefined} size={40} />
                ) : (
                  <time dateTime={message.timestamp}>{formatDirectMessageTime(message.timestamp)}</time>
                )}
              </div>

              <div className="direct-message-entry__body">
                {startsGroup && (
                  <header>
                    <strong>{userName(author)}</strong>
                    <time dateTime={message.timestamp}>{formatDirectMessageTime(message.timestamp)}</time>
                    {pending && (
                      <span className="direct-message-entry__pending">
                        <Clock3 aria-hidden="true" /> Отправляется…
                      </span>
                    )}
                  </header>
                )}

                {message.content && (
                  <div className={`direct-message-entry__content ${pending ? 'is-pending' : ''}`}>
                    <RichMessageContent
                      content={message.content}
                      currentUserId={currentUser?.id}
                      resolveMentionLabel={(id) => (
                        id === currentUser?.id
                          ? currentUser?.username || 'вы'
                          : id === friend.id
                            ? friend.username
                            : `user_${id}`
                      )}
                    />
                    {!pending && <MessageLinkEmbeds content={message.content} />}
                  </div>
                )}

                {message.attachments && message.attachments.length > 0 && (
                  <div className={`direct-message-entry__attachments ${pending ? 'is-pending' : ''}`}>
                    <MessageAttachmentGallery
                      attachments={message.attachments}
                      onOpen={(url) => onOpenAttachment(message, url)}
                    />
                    <ManagedMessageAttachments attachments={message.attachments} />
                  </div>
                )}

                <MessageMedia stickers={message.sticker_items} gif={message.gif} />

                {message.reactions && message.reactions.length > 0 && (
                  <div className="direct-message-reactions">
                    {message.reactions.map((reaction) => (
                      <button
                        type="button"
                        key={reaction.id}
                        className={reaction.currentUserReacted ? 'is-selected' : undefined}
                        onClick={() => onAddReaction(message.id, reaction.emoji)}
                        title={reaction.users.map((user) => user.username).join(', ')}
                        aria-label={`${reaction.emoji}, реакций: ${reaction.count}`}
                      >
                        <span>{reaction.emoji}</span>
                        <small>{reaction.count}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {!pending && (
                <div className="direct-message-actions" aria-label="Действия с сообщением">
                  <button
                    type="button"
                    onClick={() => onToggleEmoji(message.id)}
                    aria-label="Добавить реакцию"
                    title="Добавить реакцию"
                  >
                    <Smile aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onReply(message)}
                    aria-label="Ответить"
                    title="Ответить"
                  >
                    <Reply aria-hidden="true" />
                  </button>
                  {canDelete(message) && (
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => onDelete(message.id)}
                      aria-label="Удалить сообщение"
                      title="Удалить"
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}

              <EmojiPickerPopover
                open={openEmojiFor === message.id}
                onClose={onCloseEmoji}
                onSelect={(emoji) => onAddReaction(message.id, emoji)}
                className="direct-message-emoji-picker"
              />
            </article>
          </div>
        )
      })}
    </div>
  )
}
