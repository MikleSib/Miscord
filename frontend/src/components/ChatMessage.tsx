'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Reply, Smile, Trash2, Edit3, Pin, PinOff, Puzzle, MessageCircle, Bookmark, Flag } from 'lucide-react'
import { Message, User } from '../types'
import { UserAvatar } from './ui/user-avatar'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'
import { formatMessageTime, formatMessageFullTime } from '../lib/utils'
import { messageService } from '../services/messageService'
import { useChatStore } from '../store/chatStore'
import { MediaLightbox, MediaLightboxItem } from './MediaLightbox'
import { MessageMedia, RichMessageContent } from './media/MessageMedia'
import { MessageLinkEmbeds } from './MessageLinkEmbeds'
import { RichMessageEmbeds } from './RichMessageEmbeds'
import { ManagedMessageAttachments } from './ManagedMessageAttachments'
import { MessageAttachmentGallery } from './MessageAttachmentGallery'
import { RichWebhookEmbed } from '../types/webhook'
import { contentMentionsUser } from '../lib/mentions'
import { previewMessageText } from '../lib/markdown'
import { EmojiPickerPopover } from './emoji/EmojiPickerPopover'
import { useMentionNotificationStore } from '../store/mentionNotificationStore'
import { cn } from '../lib/utils'
import { ApplicationMessageComponents } from './ApplicationMessageComponents'
import type { MiscordApplicationCommand } from '../types/bot'
import { MessagePoll } from './community/MessagePoll'
import { messageStateService } from '../services/messageStateService'
import { SafetyReportDialog } from './safety/SafetyReportDialog'

interface ChatMessageProps {
  message: Message;
  showAuthor: boolean;
  onReply: (message: Message) => void;
  onReaction: (messageId: number, emoji: string) => void;
  currentUser?: User;
  resolveMentionLabel?: (userId: number) => string;
  onMentionClick?: (userId: number, anchorRect: DOMRect) => void;
  /** Цвет ника по высшей роли на сервере (например #ed4245) */
  authorColor?: string | null;
  /** Цвет ника автора ответа */
  replyAuthorColor?: string | null;
  applicationCommands?: MiscordApplicationCommand[];
  onApplicationCommand?: (command: MiscordApplicationCommand, message: Message) => void;
  isPinned?: boolean;
  canPin?: boolean;
  onTogglePin?: (messageId: number, pinned: boolean) => void;
  onCreateThread?: (message: Message) => void;
}

export function ChatMessage({
  message,
  showAuthor,
  onReply,
  onReaction,
  currentUser,
  resolveMentionLabel,
  onMentionClick,
  authorColor,
  replyAuthorColor,
  applicationCommands = [],
  onApplicationCommand,
  isPinned = false,
  canPin = false,
  onTogglePin,
  onCreateThread,
}: ChatMessageProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content || '')
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [lightboxItem, setLightboxItem] = useState<MediaLightboxItem | null>(null)
  const [saved, setSaved] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  const { deleteMessage, editMessage } = useChatStore()
  const mentionsCurrentUser = contentMentionsUser(message.content, currentUser?.id)
  const isUnreadMention = useMentionNotificationStore((state) =>
    state.pending.some((item) => item.messageId === message.id)
  )
  const markMentionRead = useMentionNotificationStore((state) => state.markMessageRead)
  // Пока непрочитано — синий фон; после прочтения класс снимается и фон плавно гаснет ~2с
  const showMentionHighlight = isUnreadMention
  const mentionLabel = resolveMentionLabel || ((userId: number) => `user_${userId}`)

  // Если пинг виден на экране — считаем прочитанным (как обычное SMS)
  useEffect(() => {
    if (!mentionsCurrentUser || !isUnreadMention) return
    const el = rowRef.current
    if (!el) return

    let visibleTimer: number | null = null
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.35) {
          if (visibleTimer == null) {
            visibleTimer = window.setTimeout(() => {
              markMentionRead(message.id)
            }, 500)
          }
        } else if (visibleTimer != null) {
          window.clearTimeout(visibleTimer)
          visibleTimer = null
        }
      },
      { threshold: [0.35, 0.6] }
    )

    observer.observe(el)
    return () => {
      observer.disconnect()
      if (visibleTimer != null) window.clearTimeout(visibleTimer)
    }
  }, [mentionsCurrentUser, isUnreadMention, markMentionRead, message.id])

  const handleReaction = (emoji: string) => {
    onReaction(message.id, emoji);
    setShowEmojiPicker(false);
  }

  // Проверяем, может ли текущий пользователь редактировать/удалять это сообщение
  const canEditDelete = currentUser &&
    !(message.author as typeof message.author & { is_webhook?: boolean }).is_webhook &&
    !message.author.is_bot &&
    message.author.id === currentUser.id &&
    (new Date().getTime() - new Date(message.timestamp).getTime()) < 2 * 60 * 60 * 1000; // 2 часа

  const handleDelete = async () => {
    if (!canEditDelete) return;

    try {
      await messageService.deleteMessage(message.id);
      deleteMessage(message.id);
      setShowMoreMenu(false);
    } catch (error) {
      console.error('Ошибка удаления сообщения:', error);
    }
  }

  const handleEditStart = () => {
    if (!canEditDelete) return;
    setIsEditing(true);
    setEditContent(message.content || '');
    setShowMoreMenu(false);
  }

  const handleEditSave = async () => {
    if (!editContent.trim()) return;

    try {
      await messageService.editMessage(message.id, { content: editContent });
      editMessage(message.id, editContent);
      setIsEditing(false);
    } catch (error) {
      console.error('Ошибка редактирования сообщения:', error);
    }
  }

  const handleEditCancel = () => {
    setIsEditing(false);
    setEditContent(message.content || '');
  }

  return (
    <div
      ref={rowRef}
      id={`chat-message-${message.id}`}
      data-message-id={message.id}
      data-show-author={showAuthor}
      style={{ transition: 'background-color 2s ease-out' }}
      className={cn(
        'chat-message-row group relative flex items-start gap-3 rounded px-2 py-1',
        showAuthor && 'mt-3',
        showMentionHighlight
          ? 'bg-primary/20 hover:bg-primary/25'
          : 'hover:bg-gray-700'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerUp={(event) => { if (event.pointerType === 'touch') setIsHovered((current) => !current) }}
      onContextMenu={(event) => {
        event.preventDefault()
        setShowMoreMenu(true)
      }}
    >
      {/* Hover menu */}
      {(isHovered || showMoreMenu) && !isEditing && (
        <div className="chat-message-actions absolute right-2 top-1 z-20 flex items-center rounded-lg border border-border bg-background shadow-lg">
          {onCreateThread && (
            <Tooltip content="Создать обсуждение">
              <button type="button" onClick={() => onCreateThread(message)} aria-label="Создать обсуждение" className="p-2 text-text-quiet hover:bg-surface hover:text-foreground"><MessageCircle className="h-4 w-4" /></button>
            </Tooltip>
          )}
          <Tooltip content="Добавить реакцию">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              aria-label="Добавить реакцию"
            >
              <Smile className="w-4 h-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Ответить">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => onReply(message)}
              aria-label="Ответить"
            >
              <Reply className="w-4 h-4" />
            </Button>
          </Tooltip>
          <Tooltip content={saved ? 'Убрать из сохранённых' : 'Сохранить сообщение'}>
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-8 px-2', saved && 'text-primary')}
              onClick={() => {
                const next = !saved
                setSaved(next)
                const request = next
                  ? messageStateService.saveMessage(message.id)
                  : messageStateService.unsaveMessage(message.id)
                void request.catch(() => setSaved(!next))
              }}
              aria-label={saved ? 'Убрать из сохранённых' : 'Сохранить сообщение'}
            >
              <Bookmark className="h-4 w-4" fill={saved ? 'currentColor' : 'none'} />
            </Button>
          </Tooltip>
          {canPin && onTogglePin && !message.is_deleted && (
            <Tooltip content={isPinned ? 'Открепить' : 'Закрепить'}>
              <Button
                size="sm"
                variant="ghost"
                className={cn('h-8 px-2', isPinned && 'text-[#f0b232]')}
                onClick={() => onTogglePin(message.id, !isPinned)}
                aria-label={isPinned ? 'Открепить сообщение' : 'Закрепить сообщение'}
              >
                {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
              </Button>
            </Tooltip>
          )}
          {canEditDelete && (
            <>
              <Tooltip content="Редактировать">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  onClick={handleEditStart}
                  aria-label="Редактировать"
                >
                  <Edit3 className="w-4 h-4" />
                </Button>
              </Tooltip>
              <Tooltip content="Удалить">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-destructive hover:text-destructive"
                  onClick={handleDelete}
                  aria-label="Удалить"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </Tooltip>
            </>
          )}
          {!canEditDelete && currentUser && !message.author.is_bot && (
            <Tooltip content="Пожаловаться">
              <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground hover:text-destructive" onClick={() => setReportOpen(true)} aria-label="Пожаловаться на сообщение"><Flag className="h-4 w-4" /></Button>
            </Tooltip>
          )}
        </div>
      )}

      {showMoreMenu && applicationCommands.length > 0 && !isEditing && (
        <div className="absolute right-2 top-11 z-30 min-w-64 rounded-xl border border-white/10 bg-[#111214] p-2 shadow-2xl shadow-black/50">
          <div className="flex items-center gap-2 px-2 pb-2 pt-1 text-[11px] font-bold uppercase tracking-wider text-text-quiet"><Puzzle className="h-3.5 w-3.5" />Приложения</div>
          {applicationCommands.map((command) => (
            <button
              key={`${command.application_id}-${command.id}`}
              type="button"
              className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-text-body hover:bg-primary hover:text-white"
              onClick={() => {
                setShowMoreMenu(false)
                onApplicationCommand?.(command, message)
              }}
            >
              {command.name}
            </button>
          ))}
        </div>
      )}

      <EmojiPickerPopover
        open={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
        onSelect={handleReaction}
        className="right-2 top-10"
      />

      {/* Avatar */}
      <div className="chat-message-avatar-slot w-10 flex-shrink-0">
        {showAuthor && <UserAvatar user={message.author} size={40} />}
      </div>

      <div className="flex flex-col flex-1">
        {/* Author and timestamp */}
        {showAuthor && (
          <div className="flex items-baseline gap-2">
            <span
              className="chat-message-author cursor-default font-semibold hover:underline"
              style={authorColor ? { color: authorColor } : undefined}
            >
              {message.author.username}
            </span>
            {(message.author as typeof message.author & { is_webhook?: boolean }).is_webhook && (
              <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                WEBHOOK
              </span>
            )}
            {message.author.is_bot && (
              <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                BOT
              </span>
            )}
            <Tooltip content={formatMessageFullTime(message.timestamp)}>
              <span className="text-xs text-muted-foreground cursor-help">
                {formatMessageTime(message.timestamp)}
              </span>
            </Tooltip>
            {message.is_edited && (
              <span className="text-xs text-muted-foreground">(изменено)</span>
            )}
            {isPinned && (
              <Tooltip content="Закреплённое сообщение">
                <Pin className="h-3 w-3 text-[#f0b232]" aria-label="Закреплено" />
              </Tooltip>
            )}
          </div>
        )}

        {/* Reply reference */}
        {message.reply_to && (
          <div className="mb-1 pl-2 border-l-2 border-muted text-xs text-muted-foreground">
            <span
              className="chat-message-reply-author font-medium"
              style={replyAuthorColor ? { color: replyAuthorColor } : undefined}
            >
              {message.reply_to.author.username}
            </span>: {
              message.reply_to.is_deleted
                ? 'Сообщение удалено'
                : previewMessageText(message.reply_to.content) || 'Вложение'
            }
          </div>
        )}

        {/* Message content */}
        {isEditing ? (
          <div className="mt-1">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full p-2 text-sm border border-border rounded resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="Введите сообщение..."
            />
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={handleEditSave}>
                Сохранить
              </Button>
              <Button size="sm" variant="ghost" onClick={handleEditCancel}>
                Отмена
              </Button>
            </div>
          </div>
        ) : (
          <>
            {message.content && (
              <RichMessageContent
                content={message.content}
                currentUserId={currentUser?.id}
                resolveMentionLabel={mentionLabel}
                onMentionClick={onMentionClick}
              />
            )}
            {(message.embeds?.length ?? 0) > 0 ? (
              <RichMessageEmbeds embeds={message.embeds as unknown as RichWebhookEmbed[]} />
            ) : message.content ? (
              <MessageLinkEmbeds content={message.content} />
            ) : null}
            <MessageAttachmentGallery
              attachments={message.attachments || []}
              onOpen={(url) => setLightboxItem({
                url,
                alt: 'Вложение',
                author: message.author,
                timestamp: message.timestamp,
              })}
            />
            <ManagedMessageAttachments attachments={message.attachments || []} />
            <MessageMedia stickers={message.sticker_items} gif={message.gif} />
            <ApplicationMessageComponents message={message} />
            {message.poll && <MessagePoll initialPoll={message.poll} canClose={message.author.id === currentUser?.id} />}
          </>
        )}

        {/* Reactions */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.reactions.map((reaction) => (
              <Tooltip key={reaction.id} content={reaction.users.map((u) => u.username).join(', ')}>
                <button
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors hover:bg-muted ${
                    reaction.currentUserReacted
                      ? 'border-primary bg-primary/20 text-[#f5f5f5]'
                      : 'bg-background border-border'
                  }`}
                  onClick={() => handleReaction(reaction.emoji)}
                  aria-label={`${reaction.emoji} ${reaction.count}`}
                >
                  <span>{reaction.emoji}</span>
                  <span>{reaction.count}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        )}
      </div>

      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      <SafetyReportDialog open={reportOpen} onClose={() => setReportOpen(false)} targetUserId={message.author.id} channelId={message.channelId} messageId={message.id} />
    </div>
  )
}
