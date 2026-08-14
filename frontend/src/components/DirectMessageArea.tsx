'use client'

import { useState, useEffect, useRef } from 'react'
import { DirectMessage, User } from '../types'
import websocketService from '../services/websocketService'
import { appendChatFiles, MAX_CHAT_ATTACHMENTS } from '../lib/chatAttachments'
import { resetChatComposer } from '../lib/chatComposer'
import { OutgoingMessageCard } from './OutgoingMessageCard'
import { useOutgoingMessageStore } from '../store/outgoingMessageStore'
import api from '../services/api'
import { useAuthStore } from '../store/store'
import { MediaLightbox, MediaLightboxItem } from './MediaLightbox'
import { useComposerFormatting } from '../hooks/useComposerFormatting'
import { DirectMessageComposer } from './DirectMessageComposer'
import { AttachmentDropOverlay } from './AttachmentDropOverlay'
import { DirectMessageHeader } from './DirectMessageHeader'
import { DirectMessageTimeline } from './DirectMessageTimeline'
import { useDirectMessageHistory } from '../hooks/useDirectMessageHistory'
import { insertEmojiAtCaret } from '../lib/emoji'
import type { MessageGif } from '../types'

interface DirectMessageAreaProps {
  friend: User
  initialMessage?: string | null
  onInitialMessageSent?: () => void
  onOpenSecret: () => void
}

export function DirectMessageArea({
  friend,
  initialMessage = null,
  onInitialMessageSent,
  onOpenSecret,
}: DirectMessageAreaProps) {
  const { user } = useAuthStore()
  const {
    messages,
    setMessages,
    skip,
    hasMore,
    loading: isLoading,
    loaded: historyReady,
    loadMore,
  } = useDirectMessageHistory(user?.id, friend.id)
  const [newMessage, setNewMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const messagesEndRef = useRef<null | HTMLDivElement>(null)
  const messagesContainerRef = useRef<null | HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null)
  const dragDepthRef = useRef(0)
  const [isSending, setIsSending] = useState(false)
  const outgoingQueue = useOutgoingMessageStore((state) => state.messages)
  const initializeOutgoingQueue = useOutgoingMessageStore((state) => state.initialize)
  const enqueueOutgoing = useOutgoingMessageStore((state) => state.enqueue)
  const acknowledgeOutgoing = useOutgoingMessageStore((state) => state.acknowledge)
  const outgoingMessages = historyReady ? outgoingQueue.filter(
    (message) =>
      message.conversation.type === 'dm' &&
      message.conversation.id === friend.id &&
      !messages.some((saved) => saved.client_nonce === message.clientNonce),
  ) : []
  const applyFormattingShortcut = useComposerFormatting(messageInputRef, setNewMessage)
  const [lightboxItem, setLightboxItem] = useState<MediaLightboxItem | null>(null)
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null)
  const [openActionsFor, setOpenActionsFor] = useState<number | string | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState<number | string | null>(null)
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null)
  const [rateLimitHint, setRateLimitHint] = useState<string | null>(null)
  const initialMessageSentRef = useRef(false)

  useEffect(() => {
    const token = useAuthStore.getState().token
    if (user && token) void initializeOutgoingQueue(user.id, token)
  }, [user?.id, initializeOutgoingQueue])

  useEffect(() => {
    setRateLimitUntil(null)
    setRateLimitHint(null)
    initialMessageSentRef.current = false
  }, [friend.id])

  useEffect(() => {
    if (!rateLimitUntil) return
    const timer = window.setInterval(() => {
      if (Date.now() >= rateLimitUntil) {
        setRateLimitUntil(null)
        setRateLimitHint(null)
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [rateLimitUntil])

  const rateLimitRemainingSeconds =
    rateLimitUntil && rateLimitUntil > Date.now()
      ? Math.ceil((rateLimitUntil - Date.now()) / 1000)
      : 0
  const isRateLimited = rateLimitRemainingSeconds > 0

  const sendMessageContent = async (messageContent: string, messageFiles: File[] = []) => {
    const content = messageContent.trim()
    if ((!content && messageFiles.length === 0) || !user || isRateLimited) return
    enqueueOutgoing({
      userId: user.id,
      conversation: { type: 'dm', id: friend.id },
      content,
      files: messageFiles,
      replyToId: typeof replyingTo?.id === 'number' ? replyingTo.id : undefined,
    })
  }
  useEffect(() => {
    if (!initialMessage?.trim() || initialMessageSentRef.current || !user) return

    initialMessageSentRef.current = true
    void sendMessageContent(initialMessage.trim()).then(() => {
      onInitialMessageSent?.()
    })
  }, [friend.id, initialMessage, user])

  useEffect(() => {
    const handleNewMessage = (payload: any) => {
      // WebSocket отправляет { type: 'dm', data: {...message} }
      const message: DirectMessage = payload.data || payload;
      acknowledgeOutgoing(message.client_nonce)

      console.log('[DirectMessageArea] Получено DM сообщение:', { payload, message, currentUser: user?.id, friend: friend.id });

      if (
        (message.sender_id === user?.id && message.recipient_id === friend.id) ||
        (message.sender_id === friend.id && message.recipient_id === user?.id)
      ) {
        setMessages((prev) => {
          if (prev.some((item) => item.id === message.id)) return prev
          return [...prev, { ...message, isPending: false }]
        })
      }
    };

    const handleDMDeleted = (payload: any) => {
      const data = payload.data || payload;
      console.log('[DirectMessageArea] Сообщение удалено:', data);
      setMessages((prev) => prev.filter(m => m.id !== data.message_id));
    };

    const handleDMReactionUpdated = (payload: any) => {
      const data = payload.data || payload;
      console.log('[DirectMessageArea] Р еакция обновлена:', data);

      setMessages((prev) => prev.map(msg => {
        if (msg.id !== data.message_id) return msg;

        // Обновляем реакции для сообщения
        const updatedReactions = msg.reactions || [];
        const reactionIndex = updatedReactions.findIndex(r => r.emoji === data.emoji);

        if (data.reaction.count === 0) {
          // Удаляем реакцию если count = 0
          return {
            ...msg,
            reactions: updatedReactions.filter(r => r.emoji !== data.emoji)
          };
        } else if (reactionIndex !== -1) {
          // Обновляем существующую реакцию
          const newReactions = [...updatedReactions];
          newReactions[reactionIndex] = data.reaction;
          return { ...msg, reactions: newReactions };
        } else {
          // Добавляем новую реакцию
          return {
            ...msg,
            reactions: [...updatedReactions, data.reaction]
          };
        }
      }));
    };

    const handleRateLimit = (data: {
      message?: string
      retry_after_seconds?: number
      scope?: string
      recipient_id?: number
    }) => {
      if (data.scope && data.scope !== 'dm') return
      if (data.recipient_id && data.recipient_id !== friend.id) return

      const seconds = Math.max(1, data.retry_after_seconds || 1)
      setRateLimitUntil(Date.now() + seconds * 1000)
      setRateLimitHint(
        data.message
          ? `${data.message} (${seconds} сек.)`
          : `Слишком быстро. Подождите ${seconds} сек.`
      )

      // Убираем «фантомные» pending-сообщения, которые сервер отклонил
      setMessages((prev) => {
        const pending = prev.filter((m) => m.isPending && m.sender_id === user?.id)
        if (pending.length === 0) return prev
        const lastPending = pending[pending.length - 1]
        queueMicrotask(() => {
          if (lastPending.content) {
            setNewMessage((current) => (current.trim() ? current : lastPending.content || ''))
          }
        })
        return prev.filter((m) => m !== lastPending)
      })
    }

    websocketService.on('dm', handleNewMessage);
    websocketService.on('dm_deleted', handleDMDeleted);
    websocketService.on('dm_reaction_updated', handleDMReactionUpdated);
    websocketService.on('rate_limit', handleRateLimit);

    return () => {
      websocketService.off('dm', handleNewMessage);
      websocketService.off('dm_deleted', handleDMDeleted);
      websocketService.off('dm_reaction_updated', handleDMReactionUpdated);
      websocketService.off('rate_limit', handleRateLimit);
    };
  }, [friend.id, user?.id]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (container.scrollTop === 0 && hasMore && !isLoading) {
        void loadMore().catch((error) => {
          console.error('Не удалось загрузить более ранние сообщения:', error)
        })
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [skip, hasMore, isLoading, friend.id, loadMore]);

  const addFiles = (incoming: File[]) => {
    const result = appendChatFiles(files, incoming)
    setFiles(result.files)
    setAttachmentError(result.error)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files || []))
    e.target.value = ''
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (!pastedFiles.length) return
    e.preventDefault()
    addFiles(pastedFiles)
  }

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragDepthRef.current += 1
    setIsDraggingFiles(true)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDraggingFiles(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setIsDraggingFiles(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setAttachmentError(null)
  }

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault()
    const content = newMessage.trim()
    if ((!content && files.length === 0) || !user || isRateLimited) return

    const queuedFiles = [...files]
    setNewMessage('')
    requestAnimationFrame(() => {
      resetChatComposer(messageInputRef.current)
    })
    setFiles([])
    setReplyingTo(null)
    setAttachmentError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    await sendMessageContent(content, queuedFiles)
  }
  const handleExpressionEmoji = (token: string) => {
    const input = messageInputRef.current
    const value = input?.value ?? newMessage
    const next = insertEmojiAtCaret(value, input?.selectionStart ?? value.length, input?.selectionEnd ?? value.length, token)
    setNewMessage(next.value)
    requestAnimationFrame(() => {
      messageInputRef.current?.focus()
      messageInputRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }
  const sendExpressionMedia = (selection: { stickerIds?: number[]; gif?: MessageGif }) => {
    if (!user || isRateLimited) return
    enqueueOutgoing({ userId: user.id, conversation: { type: 'dm', id: friend.id }, content: '', ...selection })
  }
  const handleDeletePendingMessage = (tempId: string) => {
    setMessages((prev) => prev.filter(m => m.tempId !== tempId));
  }

  const handleImageClick = (msg: DirectMessage, imageUrl: string) => {
    const author =
      msg.author ||
      (msg.sender_id === user?.id
        ? user
        : msg.sender_id === friend.id
          ? friend
          : { username: 'User' })

    setLightboxItem({
      url: imageUrl,
      alt: 'Вложение',
      author,
      timestamp: msg.timestamp,
    })
  }

  const handleReply = (message: DirectMessage) => {
    setReplyingTo(message);
  }

  const handleCancelReply = () => {
    setReplyingTo(null);
  }

  const handleDeleteMessage = async (messageId: number | string) => {
    // Для pending сообщений
    if (typeof messageId === 'string') {
      handleDeletePendingMessage(messageId);
      return;
    }

    // Для отправленных сообщений
    try {
      console.log('Удаление отправленного сообщения:', messageId);
      await api.delete(`/api/v1/dms/${messageId}`);
      // Удаляем из UI сразу (оптимистично)
      setMessages((prev) => prev.filter(m => m.id !== messageId));
    } catch (error: any) {
      console.error('Ошибка удаления сообщения:', error);
      if (error.response?.status === 403) {
        alert('Сообщение можно удалить только в течение 5 минут после отправки');
      } else {
        alert('Не удалось удалить сообщение');
      }
    }
  }

  const canDeleteMessage = (msg: DirectMessage) => {
    if (msg.isPending) return true;
    if (msg.sender_id !== user?.id) return false;

    // Можно удалить если прошло менее 5 минут
    const messageTime = new Date(msg.timestamp).getTime();
    const now = new Date().getTime();
    const diffMinutes = (now - messageTime) / (1000 * 60);
    return diffMinutes < 5;
  }

  const handleAddReaction = async (messageId: number | string, emoji: string) => {
    // Не обрабатываем pending сообщения
    if (typeof messageId === 'string') {
      return;
    }

    try {
      console.log('Добавление реакции:', emoji, 'к сообщению', messageId);
      await api.post(`/api/v1/dms/${messageId}/reactions`, { emoji });
      setShowEmojiPicker(null);
    } catch (error) {
      console.error('Ошибка добавления реакции:', error);
    }
  }

  const toggleEmojiPicker = (messageId: number | string) => {
    setShowEmojiPicker(showEmojiPicker === messageId ? null : messageId);
  }


  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
  }

  useEffect(() => {
    if(skip > 30) {
      // do not scroll to bottom if we are loading more messages
      return;
    }
    scrollToBottom()
  }, [messages]);

  return (
    <div
      className="direct-message-shell relative flex min-h-0 flex-1 flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFiles && <AttachmentDropOverlay direct />}
      <DirectMessageHeader friend={friend} onOpenSecret={onOpenSecret} />

      <div ref={messagesContainerRef} className="direct-message-scroll chat-scroll">
        <DirectMessageTimeline
          messages={messages}
          currentUser={user}
          friend={friend}
          loading={isLoading}
          hasMore={hasMore}
          openActionsFor={openActionsFor}
          openEmojiFor={showEmojiPicker}
          onToggleActions={(messageId) => setOpenActionsFor((current) => current === messageId ? null : messageId)}
          onCloseActions={() => setOpenActionsFor(null)}
          onToggleEmoji={toggleEmojiPicker}
          onCloseEmoji={() => setShowEmojiPicker(null)}
          onAddReaction={(messageId, emoji) => void handleAddReaction(messageId, emoji)}
          onReply={handleReply}
          onDelete={(messageId) => void handleDeleteMessage(messageId)}
          canDelete={canDeleteMessage}
          onOpenAttachment={handleImageClick}
        />
        {user && outgoingMessages.map((message) => (
          <OutgoingMessageCard key={message.clientNonce} message={message} author={user} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <DirectMessageComposer model={{
        isRateLimited, rateLimitHint, rateLimitRemainingSeconds, handleSendMessage,
        attachmentError, replyingTo, friend, handleCancelReply, files,
        handleRemoveFile, fileInputRef, handleFileChange, isSending,
        messageInputRef, newMessage, setNewMessage, handlePaste, applyFormattingShortcut,
        handleExpressionEmoji, sendExpressionMedia,
      }} />

      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </div>
  )
}
