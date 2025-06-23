'use client'

import React from 'react'
import { X } from 'lucide-react'
import { Message } from '../types'
import { Button } from './ui/button'

interface ReplyInputProps {
  replyingTo: Message | null;
  onCancelReply: () => void;
}

export function ReplyInput({ replyingTo, onCancelReply }: ReplyInputProps) {
  if (!replyingTo) return null;

  return (
    <div className="px-4 py-2 bg-muted/50 border-l-4 border-blue-500 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Отвечаете пользователю</span>
        <span className="text-sm font-medium">{replyingTo.author.username}</span>
        <span className="text-xs text-muted-foreground">
          {replyingTo.content ? 
            (replyingTo.content.length > 50 ? 
              replyingTo.content.substring(0, 50) + '...' : 
              replyingTo.content
            ) : 
            'Вложение'
          }
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onCancelReply}
        className="h-6 w-6 p-0"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  )
} 