'use client'

import React, { useState } from 'react'
import { Reply, MoreHorizontal, Smile, Trash2, Edit3 } from 'lucide-react'
import { Message, User } from '../types'
import { UserAvatar } from './ui/user-avatar'
import { Button } from './ui/button'
import { formatMessageTime, formatMessageFullTime } from '../lib/utils'
import { messageService } from '../services/messageService'
import { useChatStore } from '../store/chatStore'
import { MediaLightbox, MediaLightboxItem } from './MediaLightbox'

interface ChatMessageProps {
  message: Message;
  showAuthor: boolean;
  onReply: (message: Message) => void;
  onReaction: (messageId: number, emoji: string) => void;
  currentUser?: User;
}

// Список доступных эмодзи для реакций
const AVAILABLE_EMOJIS = ['😀', '😂', '❤️', '👍', '👎', '😢', '😡', '😮', '🎉', '🔥'];

export function ChatMessage({ message, showAuthor, onReply, onReaction, currentUser }: ChatMessageProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content || '')
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [lightboxItem, setLightboxItem] = useState<MediaLightboxItem | null>(null)
  
  const { deleteMessage, editMessage } = useChatStore()

  const handleReaction = (emoji: string) => {
    onReaction(message.id, emoji);
    setShowEmojiPicker(false);
  }

  // Проверяем, может ли текущий пользователь редактировать/удалять это сообщение
  const canEditDelete = currentUser && 
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
      className={`group relative flex items-start gap-3 py-1 px-2 rounded transition-colors hover:bg-[#3e3f45] ${showAuthor ? 'mt-3' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Hover menu */}
      {isHovered && !isEditing && (
        <div className="absolute top-1 right-2 bg-background border border-border rounded-lg shadow-lg flex items-center z-10">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            title="Добавить реакцию"
          >
            <Smile className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={() => onReply(message)}
            title="Ответить"
          >
            <Reply className="w-4 h-4" />
          </Button>
          {canEditDelete && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                onClick={handleEditStart}
                title="Редактировать"
              >
                <Edit3 className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-destructive hover:text-destructive"
                onClick={handleDelete}
                title="Удалить"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      )}

      {/* Emoji picker */}
      {showEmojiPicker && (
        <div className="absolute top-10 right-2 bg-background border border-border rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1 z-20">
          {AVAILABLE_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              className="w-8 h-8 text-lg hover:bg-muted rounded transition-colors"
              onClick={() => handleReaction(emoji)}
              title={`Реакция ${emoji}`}
            >
              {emoji}
            </button>
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
            <span className="font-semibold">{message.author.username}</span>
            <span 
              className="text-xs text-muted-foreground cursor-help" 
              title={formatMessageFullTime(message.timestamp)}
            >
              {formatMessageTime(message.timestamp)}
            </span>
            {message.is_edited && (
              <span className="text-xs text-muted-foreground">(изменено)</span>
            )}
          </div>
        )}

        {/* Reply reference */}
        {message.reply_to && (
          <div className="mb-1 pl-2 border-l-2 border-muted text-xs text-muted-foreground">
            <span className="font-medium">{message.reply_to.author.username}</span>: {
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
          message.content && <p className="text-sm leading-relaxed">{message.content}</p>
        )}

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-col items-start gap-2">
            {message.attachments.map(att => (
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
              <button
                key={reaction.id}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors hover:bg-muted ${
                  reaction.currentUserReacted 
                    ? 'border-[#5865f2] bg-[#5865f2]/20 text-[#f5f5f5]'
                    : 'bg-background border-border'
                }`}
                onClick={() => handleReaction(reaction.emoji)}
                title={`${reaction.users.map(u => u.username).join(', ')}`}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </div>
  )
} 