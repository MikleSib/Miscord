'use client'

import React, { useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Reply, MoreHorizontal, Smile } from 'lucide-react'
import { Message, User } from '../types'
import { UserAvatar } from './ui/user-avatar'
import { Button } from './ui/button'

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

  const handleReaction = (emoji: string) => {
    onReaction(message.id, emoji);
    setShowEmojiPicker(false);
  }

  return (
    <div 
      className={`group relative flex items-start gap-3 py-1 px-2 rounded transition-colors hover:bg-muted/50 ${showAuthor ? 'mt-3' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Hover menu */}
      {isHovered && (
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
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            title="Ещё"
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
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
            <span className="text-xs text-muted-foreground">
              {format(new Date(message.timestamp), 'd MMM yyyy, HH:mm', { locale: ru })}
            </span>
          </div>
        )}

        {/* Reply reference */}
        {message.reply_to && (
          <div className="mb-1 pl-2 border-l-2 border-muted text-xs text-muted-foreground">
            <span className="font-medium">{message.reply_to.author.username}</span>: {
              message.reply_to.content && message.reply_to.content.length > 50 
                ? message.reply_to.content.substring(0, 50) + '...'
                : message.reply_to.content || 'Вложение'
            }
          </div>
        )}
        
        {/* Message content */}
        {message.content && <p className="text-sm leading-relaxed">{message.content}</p>}

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {message.attachments.map(att => (
              <a key={att.id} href={att.file_url} target="_blank" rel="noopener noreferrer">
                <img 
                  src={att.file_url} 
                  alt="Вложение"
                  className="max-w-xs max-h-80 rounded-md object-cover"
                />
              </a>
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
                    ? 'bg-blue-100 border-blue-300 text-blue-700' 
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
    </div>
  )
} 