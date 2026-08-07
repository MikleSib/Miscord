'use client'

import { useState, useEffect, useRef } from 'react'
import { DirectMessage, User } from '../types'
import directMessageService from '../services/directMessageService'
import websocketService from '../services/websocketService'
import { appendChatFiles, isVideoAttachment, MAX_CHAT_ATTACHMENTS } from '../lib/chatAttachments'
import { PendingAttachmentPreview } from './PendingAttachmentPreview'
import { OutgoingMessageCard } from './OutgoingMessageCard'
import { useOutgoingMessageStore } from '../store/outgoingMessageStore'
import api from '../services/api'
import { useAuthStore } from '../store/store'
import p2pVoiceService from '../services/p2pVoiceService'
import { Phone, PhoneOff, Send, X, Clock, PlusCircle, Smile, Reply, Trash2, Edit } from 'lucide-react'
import { UserAvatar } from './ui/user-avatar'
import { MediaLightbox, MediaLightboxItem } from './MediaLightbox'
import { MessageContent } from './MessageContent'
import { MessageLinkEmbeds } from './MessageLinkEmbeds'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

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
    (message) => message.conversation.type === 'dm' && message.conversation.id === friend.id,
  )
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

  // Р—Р°РіСЂСѓР·РєР° СЃРѕРѕР±С‰РµРЅРёР№ СЃ РїР°РіРёРЅР°С†РёРµР№
  const fetchMessages = async (loadSkip: number = 0, loadLimit: number = 30) => {
    if (isLoading) return
    setIsLoading(true)
    try {
      const messageHistory = await directMessageService.getMessages(friend.id, loadSkip, loadLimit)
      // Р“Р°СЂР°РЅС‚РёСЂСѓРµРј, С‡С‚Рѕ reactions РІСЃРµРіРґР° РјР°СЃСЃРёРІ
      const messagesWithReactions = messageHistory.map(msg => ({
        ...msg,
        reactions: msg.reactions || []
      }));
      
      if (loadSkip === 0) {
        // РџРµСЂРІРѕРЅР°С‡Р°Р»СЊРЅР°СЏ Р·Р°РіСЂСѓР·РєР°
        setMessages(messagesWithReactions)
        setSkip(messagesWithReactions.length)
        setHasMore(messagesWithReactions.length === loadLimit)
      } else {
        // РџРѕРґРіСЂСѓР·РєР° СЃС‚Р°СЂС‹С… СЃРѕРѕР±С‰РµРЅРёР№
        setMessages((prev) => [...messagesWithReactions, ...prev])
        setSkip(loadSkip + messagesWithReactions.length)
        setHasMore(messagesWithReactions.length === loadLimit)
      }
    } catch (error) {
      console.error('РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё Р»РёС‡РЅС‹С… СЃРѕРѕР±С‰РµРЅРёР№:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // РЎР±СЂРѕСЃ СЃРѕСЃС‚РѕСЏРЅРёСЏ РїСЂРё СЃРјРµРЅРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
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
      // WebSocket РѕС‚РїСЂР°РІР»СЏРµС‚ { type: 'dm', data: {...message} }
      const message: DirectMessage = payload.data || payload;
      acknowledgeOutgoing(message.client_nonce)
      
      console.log('[DirectMessageArea] РџРѕР»СѓС‡РµРЅРѕ DM СЃРѕРѕР±С‰РµРЅРёРµ:', { payload, message, currentUser: user?.id, friend: friend.id });
      
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
      console.log('[DirectMessageArea] РЎРѕРѕР±С‰РµРЅРёРµ СѓРґР°Р»РµРЅРѕ:', data);
      setMessages((prev) => prev.filter(m => m.id !== data.message_id));
    };

    const handleDMReactionUpdated = (payload: any) => {
      const data = payload.data || payload;
      console.log('[DirectMessageArea] Р РµР°РєС†РёСЏ РѕР±РЅРѕРІР»РµРЅР°:', data);
      
      setMessages((prev) => prev.map(msg => {
        if (msg.id !== data.message_id) return msg;
        
        // РћР±РЅРѕРІР»СЏРµРј СЂРµР°РєС†РёРё РґР»СЏ СЃРѕРѕР±С‰РµРЅРёСЏ
        const updatedReactions = msg.reactions || [];
        const reactionIndex = updatedReactions.findIndex(r => r.emoji === data.emoji);
        
        if (data.reaction.count === 0) {
          // РЈРґР°Р»СЏРµРј СЂРµР°РєС†РёСЋ РµСЃР»Рё count = 0
          return {
            ...msg,
            reactions: updatedReactions.filter(r => r.emoji !== data.emoji)
          };
        } else if (reactionIndex !== -1) {
          // РћР±РЅРѕРІР»СЏРµРј СЃСѓС‰РµСЃС‚РІСѓСЋС‰СѓСЋ СЂРµР°РєС†РёСЋ
          const newReactions = [...updatedReactions];
          newReactions[reactionIndex] = data.reaction;
          return { ...msg, reactions: newReactions };
        } else {
          // Р”РѕР±Р°РІР»СЏРµРј РЅРѕРІСѓСЋ СЂРµР°РєС†РёСЋ
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
          ? `${data.message} (${seconds} СЃРµРє.)`
          : `РЎР»РёС€РєРѕРј Р±С‹СЃС‚СЂРѕ. РџРѕРґРѕР¶РґРёС‚Рµ ${seconds} СЃРµРє.`
      )

      // РЈР±РёСЂР°РµРј В«С„Р°РЅС‚РѕРјРЅС‹РµВ» pending-СЃРѕРѕР±С‰РµРЅРёСЏ, РєРѕС‚РѕСЂС‹Рµ СЃРµСЂРІРµСЂ РѕС‚РєР»РѕРЅРёР»
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

  // РћР±СЂР°Р±РѕС‚С‡РёРє РїСЂРѕРєСЂСѓС‚РєРё РґР»СЏ РїРѕРґРіСЂСѓР·РєРё СЃРѕРѕР±С‰РµРЅРёР№
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

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
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
      alt: 'Р’Р»РѕР¶РµРЅРёРµ',
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
    // Р”Р»СЏ pending СЃРѕРѕР±С‰РµРЅРёР№
    if (typeof messageId === 'string') {
      handleDeletePendingMessage(messageId);
      return;
    }
    
    // Р”Р»СЏ РѕС‚РїСЂР°РІР»РµРЅРЅС‹С… СЃРѕРѕР±С‰РµРЅРёР№
    try {
      console.log('РЈРґР°Р»РµРЅРёРµ РѕС‚РїСЂР°РІР»РµРЅРЅРѕРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ:', messageId);
      await api.delete(`/api/dms/${messageId}`);
      // РЈРґР°Р»СЏРµРј РёР· UI СЃСЂР°Р·Сѓ (РѕРїС‚РёРјРёСЃС‚РёС‡РЅРѕ)
      setMessages((prev) => prev.filter(m => m.id !== messageId));
    } catch (error: any) {
      console.error('РћС€РёР±РєР° СѓРґР°Р»РµРЅРёСЏ СЃРѕРѕР±С‰РµРЅРёСЏ:', error);
      if (error.response?.status === 403) {
        alert('РЎРѕРѕР±С‰РµРЅРёРµ РјРѕР¶РЅРѕ СѓРґР°Р»РёС‚СЊ С‚РѕР»СЊРєРѕ РІ С‚РµС‡РµРЅРёРµ 5 РјРёРЅСѓС‚ РїРѕСЃР»Рµ РѕС‚РїСЂР°РІРєРё');
      } else {
        alert('РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ');
      }
    }
  }

  const canDeleteMessage = (msg: DirectMessage) => {
    if (msg.isPending) return true;
    if (msg.sender_id !== user?.id) return false;
    
    // РњРѕР¶РЅРѕ СѓРґР°Р»РёС‚СЊ РµСЃР»Рё РїСЂРѕС€Р»Рѕ РјРµРЅРµРµ 5 РјРёРЅСѓС‚
    const messageTime = new Date(msg.timestamp).getTime();
    const now = new Date().getTime();
    const diffMinutes = (now - messageTime) / (1000 * 60);
    return diffMinutes < 5;
  }

  const handleAddReaction = async (messageId: number | string, emoji: string) => {
    // РќРµ РѕР±СЂР°Р±Р°С‚С‹РІР°РµРј pending СЃРѕРѕР±С‰РµРЅРёСЏ
    if (typeof messageId === 'string') {
      return;
    }
    
    try {
      console.log('Р”РѕР±Р°РІР»РµРЅРёРµ СЂРµР°РєС†РёРё:', emoji, 'Рє СЃРѕРѕР±С‰РµРЅРёСЋ', messageId);
      await api.post(`/api/dms/${messageId}/reactions`, { emoji });
      setShowEmojiPicker(null);
    } catch (error) {
      console.error('РћС€РёР±РєР° РґРѕР±Р°РІР»РµРЅРёСЏ СЂРµР°РєС†РёРё:', error);
    }
  }

  const toggleEmojiPicker = (messageId: number | string) => {
    setShowEmojiPicker(showEmojiPicker === messageId ? null : messageId);
  }

  const quickEmojis = ['вќ¤пёЏ', 'рџ‘Ќ', 'рџ‚', 'рџ®', 'рџў', 'рџ™Џ', 'рџ‘Џ', 'рџ”Ґ'];

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

  // Р¤СѓРЅРєС†РёСЏ РґР»СЏ РѕРїСЂРµРґРµР»РµРЅРёСЏ, СЏРІР»СЏРµС‚СЃСЏ Р»Рё СЃРѕРѕР±С‰РµРЅРёРµ РѕС‚ С‚РµРєСѓС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
  const isCurrentUserMessage = (message: DirectMessage) => {
    return message.sender_id === user?.id;
  };

  // Р¤СѓРЅРєС†РёСЏ РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РґР»СЏ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ
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
      {isDraggingFiles && (
        <div className="pointer-events-none absolute inset-3 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-[#5865f2] bg-[#1e1f22]/90 backdrop-blur-sm">
          <div className="text-center">
            <PlusCircle className="mx-auto mb-3 h-10 w-10 text-[#7c86ff]" />
            <p className="text-base font-semibold text-white">Добавить файлы в сообщение</p>
            <p className="mt-1 text-sm text-[#b5bac1]">Изображения до 10 МиБ, видео до 20 МиБ</p>
          </div>
        </div>
      )}
      {/* Top bar */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-[#2c2d32] shadow-md flex-shrink-0">
        <div className="flex items-center">
          <UserAvatar user={friend} />
          <h2 className="text-white font-semibold ml-3">{friend.username}</h2>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => p2pVoiceService.initiateCall(friend.id)} className="p-2 text-gray-400 hover:text-white">
            <Phone />
          </button>
          <button onClick={() => p2pVoiceService.hangUp(friend.id)} className="p-2 text-gray-400 hover:text-white">
            <PhoneOff />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 chat-scroll">
        {messages.map((msg, index) => {
          const prevMsg = messages[index - 1];
          const isCurrentUser = isCurrentUserMessage(msg);
          const messageUser = getUserForMessage(msg);
          // РџРѕРєР°Р·С‹РІР°РµРј Р°РІС‚РѕСЂР° РµСЃР»Рё СЌС‚Рѕ РїРµСЂРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РёР»Рё РїСЂРµРґС‹РґСѓС‰РµРµ РѕС‚ РґСЂСѓРіРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
          const showAuthor = !prevMsg || prevMsg.sender_id !== msg.sender_id;
          const isPending = msg.isPending || false;
          
          return (
            <div 
              key={msg.id} 
              className={`flex items-start gap-3 ${isCurrentUser ? 'justify-end' : ''} mb-2 group relative px-2 py-1 rounded-lg transition-all ${hoveredMessageId === msg.id ? 'bg-[#2c2d32]' : ''}`}
              onMouseEnter={() => setHoveredMessageId(msg.id)}
              onMouseLeave={() => setHoveredMessageId(null)}
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
                    <div className="flex flex-col items-start gap-2">
                      {msg.attachments.map(att => isVideoAttachment(
                        (att as typeof att & { content_type?: string | null }).content_type,
                        att.file_url,
                      ) ? (
                        <video
                          key={att.id}
                          controls
                          preload="metadata"
                          src={att.file_url}
                          className={`max-h-80 max-w-lg rounded-md bg-black ${isPending ? 'opacity-70' : ''}`}
                        />
                      ) : (
                        <button
                          key={att.id}
                          type="button"
                          onClick={() => handleImageClick(msg, att.file_url)}
                          className="media-thumb"
                        >
                          <img
                            src={att.file_url}
                            alt="Р’Р»РѕР¶РµРЅРёРµ"
                            className={`max-h-80 max-w-xs rounded-md object-cover ${isPending ? 'opacity-70' : ''}`}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* Message content + РїСЂРµРІСЊСЋ СЃСЃС‹Р»РѕРє */}
                  {msg.content && (
                    <div className={`${isPending ? 'text-gray-400 opacity-70' : 'text-white'} ${isCurrentUser ? 'bg-blue-600' : 'bg-gray-700'} rounded-lg px-3 py-2 ${isPending ? 'bg-opacity-70' : ''}`}>
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

              {/* Action Buttons - РїРѕРєР°Р·С‹РІР°СЋС‚СЃСЏ РїСЂРё РЅР°РІРµРґРµРЅРёРё */}
              {hoveredMessageId === msg.id && !isPending && (
                <div className="absolute top-0 right-12 flex items-center gap-1 bg-[#1e1f22] border border-[#3e3f45] rounded-lg shadow-lg p-1">
                  <button
                    onClick={() => toggleEmojiPicker(msg.id)}
                    className="p-1.5 hover:bg-[#2c2d32] rounded text-gray-400 hover:text-white transition-colors"
                    title="Р”РѕР±Р°РІРёС‚СЊ СЂРµР°РєС†РёСЋ"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleReply(msg)}
                    className="p-1.5 hover:bg-[#2c2d32] rounded text-gray-400 hover:text-white transition-colors"
                    title="РћС‚РІРµС‚РёС‚СЊ"
                  >
                    <Reply className="w-4 h-4" />
                  </button>
                  {canDeleteMessage(msg) && (
                    <button
                      onClick={() => handleDeleteMessage(msg.id)}
                      className="p-1.5 hover:bg-[#2c2d32] rounded text-red-400 hover:text-red-300 transition-colors"
                      title="РЈРґР°Р»РёС‚СЊ"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {/* Emoji Picker */}
              {showEmojiPicker === msg.id && (
                <div className="absolute top-8 right-12 bg-[#1e1f22] border border-[#3e3f45] rounded-lg shadow-xl p-2 z-10">
                  <div className="grid grid-cols-4 gap-1">
                    {quickEmojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleAddReaction(msg.id, emoji)}
                        className="text-2xl p-2 hover:bg-[#2c2d32] rounded transition-colors"
                        title={emoji}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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

      {/* Input */}
      <div className="px-4 pb-4 border-t border-[#2c2d32] flex-shrink-0">
        {isRateLimited && (
          <div className="mb-2 rounded-md border border-[#5865f2]/30 bg-[#5865f2]/10 px-3 py-2 text-sm text-[#dbdee1]">
            {rateLimitHint || `РЎР»РёС€РєРѕРј Р±С‹СЃС‚СЂРѕ. РџРѕРґРѕР¶РґРёС‚Рµ ${rateLimitRemainingSeconds} СЃРµРє.`}
          </div>
        )}
        <form onSubmit={handleSendMessage} className="bg-[#393a41] rounded-lg flex flex-col">
          {attachmentError && (
            <div className="m-2 rounded-lg border border-[#da373c]/40 bg-[#da373c]/10 px-3 py-2 text-xs text-[#ffb8ba]">
              {attachmentError}
            </div>
          )}
          
          {/* Reply Preview */}
          {replyingTo && (
            <div className="flex items-center justify-between p-3 border-b border-[#2c2d32] bg-[#2c2d32]/50">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Reply className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400">РћС‚РІРµС‚ РґР»СЏ {replyingTo.author?.username || friend.username}</p>
                  <p className="text-sm text-white truncate">{replyingTo.content || 'РР·РѕР±СЂР°Р¶РµРЅРёРµ'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelReply}
                className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* File Previews */}
          {files.length > 0 && (
            <div className="flex gap-2 overflow-x-auto border-b border-[#2c2d32] p-2">
              {files.map((file, index) => (
                <PendingAttachmentPreview
                  key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                  file={file}
                  onRemove={() => handleRemoveFile(index)}
                />
              ))}
            </div>
          )}
          
          {/* Input Row */}
          <div className="px-4 flex items-center">
            <input 
              type="file"
              ref={fileInputRef}
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
              onChange={handleFileChange}
              className="hidden"
            />
            <button 
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-gray-400 hover:text-white mr-2"
              disabled={files.length >= MAX_CHAT_ATTACHMENTS || isSending || isRateLimited}
              title="РџСЂРёРєСЂРµРїРёС‚СЊ РёР·РѕР±СЂР°Р¶РµРЅРёСЏ РёР»Рё РІРёРґРµРѕ"
            >
              <PlusCircle className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onPaste={handlePaste}
              placeholder={replyingTo ? 'РќР°РїРёС€РёС‚Рµ РѕС‚РІРµС‚...' : `РќР°РїРёСЃР°С‚СЊ @${friend.username}`}
              className="flex-1 bg-transparent text-white placeholder-gray-400 focus:outline-none py-3"
              disabled={isSending || isRateLimited}
            />
            <button 
              type="submit" 
              className="text-gray-400 hover:text-white disabled:opacity-50" 
              disabled={(!newMessage.trim() && files.length === 0) || isSending || isRateLimited}
            >
              <Send />
            </button>
          </div>
        </form>
      </div>

      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </div>
  )
}


