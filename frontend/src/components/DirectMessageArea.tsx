'use client'

import { useState, useEffect, useRef } from 'react'
import { DirectMessage, User } from '../types'
import directMessageService from '../services/directMessageService'
import websocketService from '../services/websocketService'
import { appendChatFiles, MAX_CHAT_ATTACHMENTS } from '../lib/chatAttachments'
import { resetChatComposer } from '../lib/chatComposer'
import { ManagedMessageAttachments } from './ManagedMessageAttachments'
import { MessageAttachmentGallery } from './MessageAttachmentGallery'
import { OutgoingMessageCard } from './OutgoingMessageCard'
import { useOutgoingMessageStore } from '../store/outgoingMessageStore'
import api from '../services/api'
import { useAuthStore } from '../store/store'
import { Clock, Smile, Reply, Trash2 } from 'lucide-react'
import { UserAvatar } from './ui/user-avatar'
import { MediaLightbox, MediaLightboxItem } from './MediaLightbox'
import { MessageContent } from './MessageContent'
import { MessageLinkEmbeds } from './MessageLinkEmbeds'
import { useComposerFormatting } from '../hooks/useComposerFormatting'
import { EmojiPickerPopover } from './emoji/EmojiPickerPopover'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { DirectMessageComposer } from './DirectMessageComposer'
import { AttachmentDropOverlay } from './AttachmentDropOverlay'

interface DirectMessageAreaProps {
  friend: User
  initialMessage?: string | null
  onInitialMessageSent?: () => void
}

export function DirectMessageArea({
  friend,
  initialMessage = null,
  onInitialMessageSent,
}: DirectMessageAreaProps) {
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const { user } = useAuthStore()
  const messagesEndRef = useRef<null | HTMLDivElement>(null)
  const messagesContainerRef = useRef<null | HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null)
  const dragDepthRef = useRef(0)
  const [skip, setSkip] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const outgoingQueue = useOutgoingMessageStore((state) => state.messages)
  const initializeOutgoingQueue = useOutgoingMessageStore((state) => state.initialize)
  const enqueueOutgoing = useOutgoingMessageStore((state) => state.enqueue)
  const acknowledgeOutgoing = useOutgoingMessageStore((state) => state.acknowledge)
  const outgoingMessages = outgoingQueue.filter(
    (message) =>
      message.conversation.type === 'dm' &&
      message.conversation.id === friend.id &&
      !messages.some((saved) => saved.client_nonce === message.clientNonce),
  )
  const applyFormattingShortcut = useComposerFormatting(messageInputRef, setNewMessage)
  const [lightboxItem, setLightboxItem] = useState<MediaLightboxItem | null>(null)
  const [replyingTo, setReplyingTo] = useState<DirectMessage | null>(null)
  const [hoveredMessageId, setHoveredMessageId] = useState<number | string | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState<number | string | null>(null)
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null)
  const [rateLimitHint, setRateLimitHint] = useState<string | null>(null)
  const initialMessageSentRef = useRef(false)

  useEffect(() => {
    const token = useAuthStore.getState().token
    if (user && token) void initializeOutgoingQueue(user.id, token)
  }, [user?.id, initializeOutgoingQueue])

  const fetchMessages = async (loadSkip: number = 0, loadLimit: number = 30) => {
    if (isLoading) return
    setIsLoading(true)
    try {
      const messageHistory = await directMessageService.getMessages(friend.id, loadSkip, loadLimit)
      const messagesWithReactions = messageHistory.map(msg => ({
        ...msg,
        reactions: msg.reactions || []
      }));

      if (loadSkip === 0) {
        setMessages(messagesWithReactions)
        setSkip(messagesWithReactions.length)
        setHasMore(messagesWithReactions.length === loadLimit)
      } else {
        // Подгрузка старых сообщений
        setMessages((prev) => [...messagesWithReactions, ...prev])
        setSkip(loadSkip + messagesWithReactions.length)
        setHasMore(messagesWithReactions.length === loadLimit)
      }
    } catch (error) {
      console.error('Ошибка загрузки личных сообщений:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Сброс состояния при смене пользователя
    setMessages([])
    setSkip(0)
    setHasMore(true)
    setRateLimitUntil(null)
    setRateLimitHint(null)
    initialMessageSentRef.current = false
    fetchMessages(0)
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
        fetchMessages(skip, 30);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [skip, hasMore, isLoading, friend.id]);

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

  const isCurrentUserMessage = (message: DirectMessage) => {
    return message.sender_id === user?.id;
  };

  const getUserForMessage = (message: DirectMessage) => {
    return isCurrentUserMessage(message) ? user : friend;
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-[#323339]"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFiles && <AttachmentDropOverlay direct />}
      {/* Top bar */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-[#2c2d32] shadow-md flex-shrink-0">
        <div className="flex items-center">
          <UserAvatar user={friend} />
          <h2 className="text-white font-semibold ml-3">{friend.username}</h2>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 chat-scroll">
        {messages.map((msg, index) => {
          const prevMsg = messages[index - 1];
          const isCurrentUser = isCurrentUserMessage(msg);
          const messageUser = getUserForMessage(msg);
          // Показываем автора если это первое сообщение или предыдущее от другого пользователя
          const showAuthor = !prevMsg || prevMsg.sender_id !== msg.sender_id;
          const isPending = msg.isPending || false;

          return (
            <div
              key={msg.id}
              className={`dm-message-row flex items-start gap-3 ${isCurrentUser ? 'justify-end' : ''} mb-2 group relative px-2 py-1 rounded-lg transition-all ${hoveredMessageId === msg.id ? 'bg-[#2c2d32]' : ''}`}
              onMouseEnter={() => setHoveredMessageId(msg.id)}
              onMouseLeave={() => setHoveredMessageId(null)}
              onPointerUp={(event) => { if (event.pointerType === 'touch') setHoveredMessageId((current) => current === msg.id ? null : msg.id) }}
            >
              {!isCurrentUser && showAuthor && <UserAvatar user={messageUser as User} />}
              {!isCurrentUser && !showAuthor && <div className="w-10" />}

              <div className={`flex flex-col ${isCurrentUser ? 'items-end' : 'items-start'} flex-1`}>
                {showAuthor && (
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-white">{messageUser?.username}</p>
                    <p className="text-xs text-gray-400">
                      {format(new Date(msg.timestamp), 'd MMM yyyy, HH:mm', { locale: ru })}
                    </p>
                    {isPending && (
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <Clock className="w-3 h-3" />
                        <span>Отправляется...</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-2 max-w-lg">
                  {/* Attachments */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className={isPending ? 'opacity-70' : undefined}>
                      <MessageAttachmentGallery attachments={msg.attachments} onOpen={(url) => handleImageClick(msg, url)} />
                      <ManagedMessageAttachments attachments={msg.attachments} />
                    </div>
                  )}

                  {/* Message content + превью ссылок */}
                  {msg.content && (
                    <div className={`${isPending ? 'text-white/80 opacity-80' : 'text-white'} ${isCurrentUser ? 'bg-primary' : 'bg-surface-raised'} rounded-lg px-3 py-2 ${isPending ? 'bg-opacity-80' : ''}`}>
                      <MessageContent
                        content={msg.content}
                        currentUserId={user?.id}
                        resolveMentionLabel={(id) =>
                          id === user?.id
                            ? user.username
                            : id === friend.id
                              ? friend.username
                              : `user_${id}`
                        }
                        className={isCurrentUser ? 'text-white' : undefined}
                      />
                      {!isPending && <MessageLinkEmbeds content={msg.content} />}
                    </div>
                  )}

                  {/* Reactions */}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {msg.reactions.map((reaction) => (
                        <button
                          key={reaction.id}
                          onClick={() => handleAddReaction(msg.id, reaction.emoji)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-full text-sm transition-colors ${
                            reaction.currentUserReacted
                              ? 'bg-blue-600/20 border border-blue-600'
                              : 'bg-[#2c2d32] border border-[#3e3f45] hover:border-gray-500'
                          }`}
                          title={reaction.users.map(u => u.username).join(', ')}
                        >
                          <span>{reaction.emoji}</span>
                          <span className="text-xs text-gray-400">{reaction.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons - показываются при наведении */}
              {hoveredMessageId === msg.id && !isPending && (
                <div className="dm-message-actions absolute top-0 right-12 flex items-center gap-1 bg-[#1e1f22] border border-[#3e3f45] rounded-lg shadow-lg p-1">
                  <button
                    onClick={() => toggleEmojiPicker(msg.id)}
                    className="p-1.5 hover:bg-[#2c2d32] rounded text-gray-400 hover:text-white transition-colors"
                    title="Добавить реакцию"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleReply(msg)}
                    className="p-1.5 hover:bg-[#2c2d32] rounded text-gray-400 hover:text-white transition-colors"
                    title="Ответить"
                  >
                    <Reply className="w-4 h-4" />
                  </button>
                  {canDeleteMessage(msg) && (
                    <button
                      onClick={() => handleDeleteMessage(msg.id)}
                      className="p-1.5 hover:bg-[#2c2d32] rounded text-red-400 hover:text-red-300 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              <EmojiPickerPopover
                open={showEmojiPicker === msg.id}
                onClose={() => setShowEmojiPicker(null)}
                onSelect={(emoji) => void handleAddReaction(msg.id, emoji)}
                className="right-12 top-8"
              />

              {isCurrentUser && showAuthor && <UserAvatar user={messageUser as User} />}
              {isCurrentUser && !showAuthor && <div className="w-10" />}
            </div>
          );
        })}
        {user && outgoingMessages.map((message) => (
          <OutgoingMessageCard key={message.clientNonce} message={message} author={user} compact />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <DirectMessageComposer model={{
        isRateLimited, rateLimitHint, rateLimitRemainingSeconds, handleSendMessage,
        attachmentError, replyingTo, friend, handleCancelReply, files,
        handleRemoveFile, fileInputRef, handleFileChange, isSending,
        messageInputRef, newMessage, setNewMessage, handlePaste, applyFormattingShortcut,
      }} />

      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </div>
  )
}
