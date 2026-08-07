'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Reply, MoreHorizontal, Smile, Trash2, Edit3 } from 'lucide-react'
import { Message, User } from '../types'
import { UserAvatar } from './ui/user-avatar'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'
import { formatMessageTime, formatMessageFullTime } from '../lib/utils'
import { messageService } from '../services/messageService'
import { useChatStore } from '../store/chatStore'
import { MediaLightbox, MediaLightboxItem } from './MediaLightbox'
import { MessageContent } from './MessageContent'
import { MessageLinkEmbeds } from './MessageLinkEmbeds'
import { RichMessageEmbeds } from './RichMessageEmbeds'
import { ManagedMessageAttachments } from './ManagedMessageAttachments'
import { isVideoAttachment } from '../lib/chatAttachments'
import { RichWebhookEmbed } from '../types/webhook'
import { contentMentionsUser } from '../lib/mentions'
import { useMentionNotificationStore } from '../store/mentionNotificationStore'
import { cn } from '../lib/utils'

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
}

// Список доступных эмодзи для реакций
const AVAILABLE_EMOJIS = ['😀', '😂', '❤️', '👍', '👎', '😢', '😡', '😮', '🎉', '🔥'];

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
}: ChatMessageProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content || '')
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [lightboxItem, setLightboxItem] = useState<MediaLightboxItem | null>(null)
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
      style={{ transition: 'background-color 2s ease-out' }}
      className={cn(
        'group relative flex items-start gap-3 py-1 px-2 rounded',
        showAuthor && 'mt-3',
        showMentionHighlight
          ? 'bg-[#5865f2]/20 hover:bg-[#5865f2]/25'
          : 'hover:bg-[#3e3f45]'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Hover menu */}
      {isHovered && !isEditing && (
        <div className="absolute top-1 right-2 bg-background border border-border rounded-lg shadow-lg flex items-center z-10">
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
        </div>
      )}

      {/* Emoji picker */}
      {showEmojiPicker && (
        <div className="absolute top-10 right-2 bg-background border border-border rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1 z-20">
          {AVAILABLE_EMOJIS.map((emoji) => (
            <Tooltip key={emoji} content={`Реакция ${emoji}`}>
              <button
                className="w-8 h-8 text-lg hover:bg-muted rounded transition-colors"
                onClick={() => handleReaction(emoji)}
                aria-label={`Реакция ${emoji}`}
              >
                {emoji}
              </button>
            </Tooltip>
          ))}
        </div>
      )}

      {/* Avatar */}
      {showAuthor ? (
        <UserAvatar 
          user={message.author}
          size={40}
        />
      ) : (
        <div className="w-10 flex-shrink-0" /> 
      )}
      
      <div className="flex flex-col flex-1">
        {/* Author and timestamp */}
        {showAuthor && (
          <div className="flex items-baseline gap-2">
            <span
              className="font-semibold hover:underline cursor-default"
              style={authorColor ? { color: authorColor } : undefined}
            >
              {message.author.username}
            </span>
            {(message.author as typeof message.author & { is_webhook?: boolean }).is_webhook && (
              <span className="rounded bg-[#5865f2] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                WEBHOOK
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
          </div>
        )}

        {/* Reply reference */}
        {message.reply_to && (
          <div className="mb-1 pl-2 border-l-2 border-muted text-xs text-muted-foreground">
            <span
              className="font-medium"
              style={replyAuthorColor ? { color: replyAuthorColor } : undefined}
            >
              {message.reply_to.author.username}
            </span>: {
              message.reply_to.is_deleted 
                ? 'Сообщение удалено'
                : message.reply_to.content && message.reply_to.content.length > 50 
                  ? message.reply_to.content.substring(0, 50) + '...'
                  : message.reply_to.content || 'Вложение'
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
              <MessageContent
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
            <ManagedMessageAttachments attachments={message.attachments || []} />
          </>
        )}

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-col items-start gap-2">
            {message.attachments.filter((att) => {
              const contentType = (att as typeof att & { content_type?: string | null }).content_type
              return !contentType || contentType.startsWith('image/')
            }).map(att => isVideoAttachment(
              (att as typeof att & { content_type?: string | null }).content_type,
              att.file_url,
            ) ? (
              <video
                key={att.id}
                controls
                preload="metadata"
                src={att.file_url}
                className="max-h-[360px] max-w-lg rounded-lg bg-black"
              />
            ) : (
              <button
                key={att.id}
                type="button"
                className="media-thumb"
                onClick={() =>
                  setLightboxItem({
                    url: att.file_url,
                    alt: 'Вложение',
                    author: message.author,
                    timestamp: message.timestamp,
                  })
                }
              >
                <img
                  src={att.file_url}
                  alt="Вложение"
                  className="max-w-xs max-h-80 rounded-md object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {/* Reactions */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.reactions.map((reaction) => (
              <Tooltip key={reaction.id} content={reaction.users.map((u) => u.username).join(', ')}>
                <button
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors hover:bg-muted ${
                    reaction.currentUserReacted 
                      ? 'border-[#5865f2] bg-[#5865f2]/20 text-[#f5f5f5]'
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
    </div>
  )
} 
