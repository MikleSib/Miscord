'use client'

import React from 'react'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Hash, Send, PlusCircle, X, Users, AtSign } from 'lucide-react'
import { useStore } from '../lib/store'
import { useAuthStore } from '../store/store'
import { useChatStore } from '../store/chatStore'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from './ui/button'
import { UserAvatar } from './ui/user-avatar'
import { ChatMessage } from './ChatMessage'
import { Tooltip } from './ui/tooltip'
import { ReplyInput } from './ReplyInput'
import { MentionAutocomplete } from './MentionAutocomplete'
import { MemberProfilePopover } from './MemberProfilePopover'
import { Message, Role, ServerMember } from '../types'
import { formatDateDivider } from '../lib/utils'
import chatService from '../services/chatService'
import { appendChatFiles, MAX_CHAT_ATTACHMENTS } from '../lib/chatAttachments'
import { PendingAttachmentPreview } from './PendingAttachmentPreview'
import { OutgoingMessageCard } from './OutgoingMessageCard'
import { useOutgoingMessageStore } from '../store/outgoingMessageStore'
import reactionService from '../services/reactionService'
import serverService from '../services/serverService'
import { formatSlowModeLabel } from '../lib/slowMode'
import {
  filterMentionCandidates,
  getActiveMentionQuery,
  insertMentionHandle,
  insertMentionToken,
  serializeLooseMentions,
  toMentionCandidates,
  contentMentionsUser,
  getMemberMentionId,
  MentionCandidate,
} from '../lib/mentions'
import { shallow } from 'zustand/shallow'
import {
  useMentionNotificationStore,
  formatMentionBadge,
  PendingMention,
} from '../store/mentionNotificationStore'
import {
  shouldNotifyMentionClient,
  useNotificationSettingsStore,
} from '../store/notificationSettingsStore'

export function ChatArea({ showUserSidebar, setShowUserSidebar }: { showUserSidebar: boolean, setShowUserSidebar: (v: boolean) => void }) {
  const { currentChannel, currentServer } = useStore()
  const { user, token } = useAuthStore()
  const { 
    messages, 
    isLoading: chatLoading,
    isLoadingOlder,
    hasMoreOlder,
    error: chatError,
    loadMessageHistory,
    loadOlderMessages,
    addMessage,
    updateMessageReactions,
    updateSingleReaction,
    deleteMessage,
    editMessage
  } = useChatStore()
  
  // Р›РѕРіРёСЂСѓРµРј РёР·РјРµРЅРµРЅРёСЏ currentChannel
  useEffect(() => {
  }, [currentChannel]);
  
  const [messageInput, setMessageInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const outgoingQueue = useOutgoingMessageStore((state) => state.messages)
  const initializeOutgoingQueue = useOutgoingMessageStore((state) => state.initialize)
  const enqueueOutgoing = useOutgoingMessageStore((state) => state.enqueue)
  const outgoingMessages = useMemo(
    () => outgoingQueue.filter((message) =>
      message.conversation.type === 'channel' &&
      message.conversation.id === currentChannel?.id &&
      !messages.some((saved) => saved.client_nonce === message.clientNonce)
    ),
    [outgoingQueue, currentChannel?.id, messages],
  )

  useEffect(() => {
    if (user && token) void initializeOutgoingQueue(user.id, token)
  }, [user?.id, token, initializeOutgoingQueue])
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [slowModeUntil, setSlowModeUntil] = useState<number | null>(null)
  const [sendLimitHint, setSendLimitHint] = useState<string | null>(null)
  const [mentionMembers, setMentionMembers] = useState<ServerMember[]>([])
  const [serverRoles, setServerRoles] = useState<Role[]>([])
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [profilePopover, setProfilePopover] = useState<{
    member: ServerMember
    anchorRect: DOMRect
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const messageInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)
  const suppressAutoScrollRef = useRef(false)
  /** Р”РµСЂР¶РёРј РЅРёР· С‡Р°С‚Р°, РїРѕРєР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃР°Рј РЅРµ СѓС€С‘Р» РІРІРµСЂС… С‡РёС‚Р°С‚СЊ РёСЃС‚РѕСЂРёСЋ */
  const stickToBottomRef = useRef(true)
  /** РРіРЅРѕСЂРёРј onScroll РїРѕРєР° СЃР°РјРё РїСЂС‹РіР°РµРј РІРЅРёР· (РёРЅР°С‡Рµ stick СЃР±СЂР°СЃС‹РІР°РµС‚СЃСЏ) */
  const programmaticScrollRef = useRef(false)
  /** Р§С‚РѕР±С‹ СЃРєСЂРѕР»Р» РІРІРµСЂС… РЅРµ Р·Р°РїСЂРѕСЃРёР» РѕРґРЅСѓ РїР°С‡РєСѓ РЅРµСЃРєРѕР»СЊРєРѕ СЂР°Р· РїРѕРґСЂСЏРґ */
  const loadingOlderLockRef = useRef(false)

  const channelIdForMentions =
    currentChannel?.type === 'text' ? currentChannel.id : null
  const channelMentions = useMentionNotificationStore(
    (state): PendingMention[] => {
      if (channelIdForMentions == null) return []
      return state.pending
        .filter((item) => item.textChannelId === channelIdForMentions)
        .sort((a, b) => a.createdAt - b.createdAt || a.messageId - b.messageId)
    },
    shallow
  )
  const markMentionRead = useMentionNotificationStore((state) => state.markMessageRead)
  const addMentionNotification = useMentionNotificationStore((state) => state.addMention)

  const mentionCandidates = useMemo(
    () => toMentionCandidates(mentionMembers),
    [mentionMembers]
  )

  const filteredMentions = useMemo(
    () => (mentionQuery ? filterMentionCandidates(mentionCandidates, mentionQuery.query) : []),
    [mentionCandidates, mentionQuery]
  )

  const mentionNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const candidate of mentionCandidates) {
      map.set(candidate.id, candidate.displayName)
    }
    return map
  }, [mentionCandidates])

  const resolveMentionLabel = useCallback(
    (userId: number) => mentionNameById.get(userId) || `user_${userId}`,
    [mentionNameById]
  )

  // РЎРїРёСЃРѕРє СѓС‡Р°СЃС‚РЅРёРєРѕРІ Рё СЂРѕР»РµР№ вЂ” РґР»СЏ @СѓРїРѕРјРёРЅР°РЅРёР№ Рё РєР°СЂС‚РѕС‡РєРё РїСЂРѕС„РёР»СЏ
  useEffect(() => {
    if (!currentServer?.id || currentChannel?.type !== 'text') {
      setMentionMembers([])
      setServerRoles([])
      setProfilePopover(null)
      return
    }

    let cancelled = false
    Promise.all([
      serverService.getMembers(currentServer.id),
      serverService.getRoles(currentServer.id),
    ])
      .then(([membersResponse, rolesResponse]) => {
        if (cancelled) return
        setMentionMembers(membersResponse.members)
        setServerRoles(rolesResponse)
      })
      .catch((error) => {
        console.error('РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СѓС‡Р°СЃС‚РЅРёРєРѕРІ РґР»СЏ СѓРїРѕРјРёРЅР°РЅРёР№:', error)
      })

    return () => {
      cancelled = true
    }
  }, [currentServer?.id, currentChannel?.type])

  const handleMentionClick = useCallback(
    (userId: number, anchorRect: DOMRect) => {
      const member = mentionMembers.find((item) => getMemberMentionId(item) === userId)
      if (!member) return
      setProfilePopover({ member, anchorRect })
    },
    [mentionMembers]
  )

  /** Р¦РІРµС‚ РЅРёРєР° СѓС‡Р°СЃС‚РЅРёРєР° РїРѕ СЂРѕР»Рё (РєР°Рє РІ СЃРїРёСЃРєРµ СЃРїСЂР°РІР°) */
  const getMemberColor = useCallback(
    (userId: number | undefined | null): string | null => {
      if (!userId) return null
      const member = mentionMembers.find((item) => getMemberMentionId(item) === userId)
      return member?.color || null
    },
    [mentionMembers]
  )

  const handleProfileMemberUpdated = useCallback((updatedMember: ServerMember) => {
    setMentionMembers((prev) =>
      prev.map((member) =>
        getMemberMentionId(member) === updatedMember.user_id ? updatedMember : member
      )
    )
    setProfilePopover((prev) =>
      prev && prev.member.user_id === updatedMember.user_id
        ? { ...prev, member: updatedMember }
        : prev
    )
  }, [])

  useEffect(() => {
    setSlowModeUntil(null)
    setSendLimitHint(null)
  }, [currentChannel?.id, currentChannel?.type])

  // Р—Р°С€Р»Рё РІ РєР°РЅР°Р» вЂ” РІСЃРµРіРґР° РЅР°С‡РёРЅР°РµРј СЃ РїРѕСЃР»РµРґРЅРёС… СЃРѕРѕР±С‰РµРЅРёР№ (РЅРёР·)
  useEffect(() => {
    if (currentChannel?.type !== 'text') return
    stickToBottomRef.current = true
  }, [currentChannel?.id, currentChannel?.type])

  useEffect(() => {
    if (!slowModeUntil) return
    const timer = window.setInterval(() => {
      if (Date.now() >= slowModeUntil) {
        setSlowModeUntil(null)
        setSendLimitHint(null)
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [slowModeUntil])

  const slowModeRemainingSeconds =
    slowModeUntil && slowModeUntil > Date.now()
      ? Math.ceil((slowModeUntil - Date.now()) / 1000)
      : 0
  const isSlowModeActive = slowModeRemainingSeconds > 0

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = messagesContainerRef.current
    if (!container) return
    programmaticScrollRef.current = true
    if (behavior === 'smooth') {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    } else {
      // РњРіРЅРѕРІРµРЅРЅРѕ вЂ” РёРЅР°С‡Рµ РїСЂРё РєСѓС‡Рµ СЃРѕРѕР±С‰РµРЅРёР№ smooth В«Р»РѕРјР°РµС‚СЃСЏВ» Рё РѕСЃС‚Р°С‘С€СЊСЃСЏ РЅР°РІРµСЂС…Сѓ
      container.scrollTop = container.scrollHeight
    }
    // РќР° РІСЃСЏРєРёР№ СЃР»СѓС‡Р°Р№ СЏРєРѕСЂСЊ РІ РєРѕРЅС†Рµ СЃРїРёСЃРєР°
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })
    // Р”Р°С‘Рј Р±СЂР°СѓР·РµСЂСѓ РїСЂРёРјРµРЅРёС‚СЊ scrollTop, РїРѕС‚РѕРј СЃРЅРѕРІР° СЃР»СѓС€Р°РµРј onScroll
    window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
  }, [])

  const handleMessagesScroll = useCallback(() => {
    if (programmaticScrollRef.current) return
    const container = messagesContainerRef.current
    if (!container) return

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    stickToBottomRef.current = distanceFromBottom < 140

    // РљР°Рє РІ Discord: РґРѕСЃРєСЂРѕР»Р»РёР» РІРІРµСЂС… в†’ РїРѕРґРіСЂСѓР·РёС‚СЊ РµС‰С‘ РїР°С‡РєСѓ СЃС‚Р°СЂС‹С…
    if (
      container.scrollTop < 80 &&
      hasMoreOlder &&
      !isLoadingOlder &&
      !chatLoading &&
      !loadingOlderLockRef.current
    ) {
      const prevHeight = container.scrollHeight
      const prevTop = container.scrollTop
      suppressAutoScrollRef.current = true
      stickToBottomRef.current = false
      loadingOlderLockRef.current = true

      void loadOlderMessages()
        .then((added) => {
          if (!added) return
          // РЎРѕС…СЂР°РЅСЏРµРј РїРѕР·РёС†РёСЋ РіР»Р°Р·: РїРѕСЃР»Рµ prepend РЅРµ РїСЂС‹РіР°РµРј
          window.requestAnimationFrame(() => {
            const el = messagesContainerRef.current
            if (!el) return
            programmaticScrollRef.current = true
            el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
            window.requestAnimationFrame(() => {
              programmaticScrollRef.current = false
            })
          })
        })
        .finally(() => {
          loadingOlderLockRef.current = false
        })
    }
  }, [hasMoreOlder, isLoadingOlder, chatLoading, loadOlderMessages])

  // РџРѕРєР° В«РїСЂРёР»РёРїР»РёВ» Рє РЅРёР·Сѓ вЂ” Р»СЋР±РѕР№ СЂРѕСЃС‚ РІС‹СЃРѕС‚С‹ (РїСЂРµРІСЊСЋ, РєР°СЂС‚РёРЅРєРё) СЃРЅРѕРІР° РєРёРґР°РµС‚ РІРЅРёР·
  useEffect(() => {
    const content = messagesContentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return
      scrollMessagesToBottom('auto')
    })
    observer.observe(content)

    return () => observer.disconnect()
  }, [scrollMessagesToBottom, currentChannel?.id, messages.length])

  // Р—Р°РіСЂСѓР·РєР° РёСЃС‚РѕСЂРёРё СЃРѕРѕР±С‰РµРЅРёР№ РїСЂРё СЃРјРµРЅРµ РєР°РЅР°Р»Р°
  useEffect(() => {
    if (currentChannel?.type === 'text') {
      stickToBottomRef.current = true
      loadMessageHistory(currentChannel.id);
      
      // РџРѕРґРєР»СЋС‡Р°РµРјСЃСЏ Рє WebSocket С‡Р°С‚Р° С‚РѕР»СЊРєРѕ РµСЃР»Рё РµС‰Рµ РЅРµ РїРѕРґРєР»СЋС‡РµРЅС‹
      const accessToken = token || localStorage.getItem('access_token');
      
      if (accessToken) {
        
        // РћР±СЂР°Р±РѕС‚С‡РёРє РЅРѕРІС‹С… СЃРѕРѕР±С‰РµРЅРёР№
        chatService.onMessage((msg) => {
          // РђРґР°РїС‚РёСЂСѓРµРј Message Рє ChatMessage
          const chatMessage = {
            ...msg,
            content: msg.content || '', // Р“Р°СЂР°РЅС‚РёСЂСѓРµРј С‡С‚Рѕ content РЅРµ null
          };
          addMessage(chatMessage);

          // Р•СЃР»Рё РІ СЃРѕРѕР±С‰РµРЅРёРё РїРёРЅРі С‚РµРєСѓС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ вЂ” РєР»Р°РґС‘Рј РІ РЅРµРїСЂРѕС‡РёС‚Р°РЅРЅС‹Рµ
          // (РґРµРґСѓРї СЃРѕ Р·РІСѓРєРѕРј СѓР¶Рµ РІРЅСѓС‚СЂРё store; СЃРѕР±С‹С‚РёРµ mention С‚РѕР¶Рµ РјРѕР¶РµС‚ РїСЂРёР№С‚Рё)
          if (
            currentServer?.id &&
            user?.id &&
            msg.author?.id !== user.id &&
            contentMentionsUser(chatMessage.content, user.id)
          ) {
            const notificationSettings = useNotificationSettingsStore
              .getState()
              .get(currentServer.id)
            if (shouldNotifyMentionClient(notificationSettings, currentChannel.id)) {
              addMentionNotification({
                messageId: msg.id,
                textChannelId: currentChannel.id,
                serverId: currentServer.id,
                channelName: currentChannel.name,
              })
            }
          }
        });
        
        // РћР±СЂР°Р±РѕС‚С‡РёРє РїРµС‡Р°С‚Рё
        chatService.onTyping((data) => {
          if (data.user && data.user.username) {
            setTypingUsers(prev => {
              if (!prev.includes(data.user.username)) {
                const newUsers = [...prev, data.user.username];
                setTimeout(() => {
                  setTypingUsers(current => current.filter(u => u !== data.user.username));
                }, 2000);
                return newUsers;
              }
              return prev;
            });
          }
        });

        // РћР±СЂР°Р±РѕС‚С‡РёРє СѓРґР°Р»РµРЅРёСЏ СЃРѕРѕР±С‰РµРЅРёР№
        chatService.onMessageDeleted((data) => {
          deleteMessage(data.message_id);
        });

        // РћР±СЂР°Р±РѕС‚С‡РёРє СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёСЏ СЃРѕРѕР±С‰РµРЅРёР№
        chatService.onMessageEdited((msg) => {
          editMessage(msg.id, msg.content || '');
        });

        // РћР±СЂР°Р±РѕС‚С‡РёРє РѕР±РЅРѕРІР»РµРЅРёСЏ СЂРµР°РєС†РёР№
        chatService.onReactionUpdated((data) => {
          updateSingleReaction(data.message_id, data.emoji, data.reaction);
        });

        chatService.onSlowMode((data) => {
          if (data.text_channel_id !== currentChannel.id) return;
          setSlowModeUntil(Date.now() + data.retry_after_seconds * 1000);
          setSendLimitHint(
            `РџРѕРґРѕР¶РґРёС‚Рµ ${data.retry_after_seconds} СЃРµРє. вЂ” РІ СЌС‚РѕРј РєР°РЅР°Р»Рµ РІРєР»СЋС‡С‘РЅ РјРµРґР»РµРЅРЅС‹Р№ СЂРµР¶РёРј.`
          );
        });

        chatService.onRateLimit((data) => {
          if (data.text_channel_id && data.text_channel_id !== currentChannel.id) return;
          const seconds = Math.max(1, data.retry_after_seconds || 1);
          setSlowModeUntil(Date.now() + seconds * 1000);
          setSendLimitHint(
            data.message
              ? `${data.message} (${seconds} СЃРµРє.)`
              : `РЎР»РёС€РєРѕРј Р±С‹СЃС‚СЂРѕ. РџРѕРґРѕР¶РґРёС‚Рµ ${seconds} СЃРµРє.`
          );
        });
      }
    } else {
      setTypingUsers([]);
    }
    
    // Cleanup function
    return () => {
      setTypingUsers([]);
    };
  }, [
    currentChannel?.id,
    currentChannel?.type,
    currentChannel?.name,
    currentServer?.id,
    user?.id,
    loadMessageHistory,
    addMessage,
    deleteMessage,
    editMessage,
    token,
    addMentionNotification,
  ]);

  // РџРѕСЃР»Рµ Р·Р°РіСЂСѓР·РєРё/РЅРѕРІС‹С… СЃРѕРѕР±С‰РµРЅРёР№ вЂ” РїСЂС‹РіР°РµРј РІРЅРёР· (Рё РїСЂРё F5 / СЃРјРµРЅРµ РєР°РЅР°Р»Р°)
  useEffect(() => {
    if (suppressAutoScrollRef.current) {
      suppressAutoScrollRef.current = false
      return
    }
    if (!stickToBottomRef.current) return
    if (!messages.length) return

    let cancelled = false
    const timers: number[] = []

    const jump = () => {
      if (cancelled || !stickToBottomRef.current) return
      scrollMessagesToBottom('auto')
    }

    // РќРµСЃРєРѕР»СЊРєРѕ РїРѕРїС‹С‚РѕРє: РїРѕСЃР»Рµ paint, РїРѕСЃР»Рµ layout Рё РїРѕСЃР»Рµ РїСЂРµРІСЊСЋ/РєР°СЂС‚РёРЅРѕРє
    const frame1 = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(jump)
    })
    timers.push(window.setTimeout(jump, 0))
    timers.push(window.setTimeout(jump, 50))
    timers.push(window.setTimeout(jump, 200))
    timers.push(window.setTimeout(jump, 500))
    timers.push(window.setTimeout(jump, 1000))

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame1)
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [messages, currentChannel?.id, chatLoading, scrollMessagesToBottom])

  const scrollToMention = useCallback((messageId: number) => {
    const el = document.getElementById(`chat-message-${messageId}`)
    if (!el) return false

    suppressAutoScrollRef.current = true
    stickToBottomRef.current = false
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-[#5865f2]', 'ring-offset-2', 'ring-offset-background')
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-[#5865f2]', 'ring-offset-2', 'ring-offset-background')
    }, 1600)
    return true
  }, [])

  /** РљР°Рє РІ Telegram: РєР°Р¶РґС‹Р№ РєР»РёРє вЂ” Рє СЃР»РµРґСѓСЋС‰РµРјСѓ РЅРµРїСЂРѕС‡РёС‚Р°РЅРЅРѕРјСѓ РїРёРЅРіСѓ. */
  const handleJumpToMention = useCallback(() => {
    const target = channelMentions[0]
    if (!target) return

    if (!scrollToMention(target.messageId)) {
      // РЎРѕРѕР±С‰РµРЅРёСЏ РЅРµС‚ РІ Р·Р°РіСЂСѓР¶РµРЅРЅРѕР№ РёСЃС‚РѕСЂРёРё вЂ” СЃРЅРёРјР°РµРј, С‡С‚РѕР±С‹ РЅРµ Р·Р°СЃС‚СЂРµРІР°С‚СЊ
      markMentionRead(target.messageId)
    }
    // РџСЂРѕС‡РёС‚Р°РЅРЅС‹Рј СЃС‚Р°РЅРµС‚ СЃР°РјРѕ СЃРѕРѕР±С‰РµРЅРёРµ, РєРѕРіРґР° РѕРЅРѕ РѕРєР°Р¶РµС‚СЃСЏ РЅР° СЌРєСЂР°РЅРµ (Рё С„РѕРЅ РїР»Р°РІРЅРѕ РїРѕРіР°СЃРЅРµС‚)
  }, [channelMentions, markMentionRead, scrollToMention])

  const addFiles = useCallback((incoming: File[]) => {
    const result = appendChatFiles(files, incoming)
    setFiles(result.files)
    setAttachmentError(result.error)
  }, [files])

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

  const updateMentionState = (value: string, caret: number) => {
    const active = getActiveMentionQuery(value, caret)
    setMentionQuery(active)
    setMentionIndex(0)
  }

  const applyMention = (candidate: MentionCandidate) => {
    if (!mentionQuery) return

    const input = messageInputRef.current
    const caret = input?.selectionStart ?? messageInput.length
    const safeUsername = /^[\w.-]+$/.test(candidate.username)
    const next = safeUsername
      ? insertMentionHandle(messageInput, caret, mentionQuery.start, candidate.username)
      : insertMentionToken(messageInput, caret, mentionQuery.start, candidate.id)

    setMessageInput(next.value)
    setMentionQuery(null)
    setMentionIndex(0)

    requestAnimationFrame(() => {
      const el = messageInputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault()
    const content = messageInput.trim()
    if ((!content && files.length === 0) || !user || !currentChannel) return

    const queuedFiles = [...files]
    const replyToId = replyingTo?.id
    setMessageInput('')
    setFiles([])
    setReplyingTo(null)
    setAttachmentError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''

    enqueueOutgoing({
      userId: user.id,
      conversation: { type: 'channel', id: currentChannel.id },
      content,
      files: queuedFiles,
      replyToId,
    })
  }
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    const caret = e.target.selectionStart ?? value.length
    setMessageInput(value)
    updateMentionState(value, caret)
    if (currentChannel?.type === 'text') {
      chatService.sendTyping();
    }
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!mentionQuery || filteredMentions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIndex((prev) => (prev + 1) % filteredMentions.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex((prev) => (prev - 1 + filteredMentions.length) % filteredMentions.length)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setMentionQuery(null)
      return
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      applyMention(filteredMentions[mentionIndex] || filteredMentions[0])
    }
  }

  const handleReply = (message: Message) => {
    setReplyingTo(message);
  }

  const handleCancelReply = () => {
    setReplyingTo(null);
  }

  const handleReaction = async (messageId: number, emoji: string) => {
    try {
      // toggleReaction РІРѕР·РІСЂР°С‰Р°РµС‚ РѕР±РЅРѕРІР»РµРЅРЅСѓСЋ СЂРµР°РєС†РёСЋ
      const updatedReaction = await reactionService.toggleReaction(messageId, emoji);
      
      // РќРµ РѕР±РЅРѕРІР»СЏРµРј Р»РѕРєР°Р»СЊРЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ Р·РґРµСЃСЊ - РѕРЅРѕ Р±СѓРґРµС‚ РѕР±РЅРѕРІР»РµРЅРѕ С‡РµСЂРµР· WebSocket
      // WebSocket РїРѕР»СѓС‡РёС‚ СЃРѕР±С‹С‚РёРµ reaction_updated Рё РѕР±РЅРѕРІРёС‚ СЃРѕСЃС‚РѕСЏРЅРёРµ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё
      
      console.log('Р РµР°РєС†РёСЏ РѕР±РЅРѕРІР»РµРЅР°:', emoji, 'РЅР° СЃРѕРѕР±С‰РµРЅРёРµ:', messageId, updatedReaction);
    } catch (error) {
      console.error('РћС€РёР±РєР° РїСЂРё РёР·РјРµРЅРµРЅРёРё СЂРµР°РєС†РёРё:', error);
      
      // Р•СЃР»Рё РїСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР°, РјРѕР¶РµРј РїРѕРїСЂРѕР±РѕРІР°С‚СЊ РѕР±РЅРѕРІРёС‚СЊ Р»РѕРєР°Р»СЊРЅРѕ
      try {
        const allReactions = await reactionService.getMessageReactions(messageId);
        updateMessageReactions(messageId, allReactions);
      } catch (fallbackError) {
        console.error('РћС€РёР±РєР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё СЂРµР°РєС†РёР№:', fallbackError);
      }
    }
  }
  
  const TypingIndicator = () => {
    if (typingUsers.length === 0) return null;
    
    let text = '';
    if (typingUsers.length === 1) {
      text = `${typingUsers[0]} РїРµС‡Р°С‚Р°РµС‚...`;
    } else if (typingUsers.length > 1 && typingUsers.length < 4) {
      text = `${typingUsers.join(', ')} РїРµС‡Р°С‚Р°СЋС‚...`;
    } else {
      text = 'РќРµСЃРєРѕР»СЊРєРѕ С‡РµР»РѕРІРµРє РїРµС‡Р°С‚Р°СЋС‚...';
    }

    return <div className="px-4 text-xs text-muted-foreground h-4 mb-1">{text}</div>;
  }

  if (!currentChannel) {
    return (
      <div className="app-shell flex min-w-0 flex-1 items-center justify-center">
        <div className="text-muted-foreground text-center">
          <p className="text-2xl mb-2">Добро пожаловать!</p>
          <p>Выберите канал для начала общения</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full min-w-0 flex-1 flex-col bg-background"
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
      {/* Channel Header */}
      <div className="app-header flex h-12 flex-shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center">
          <Hash className="w-5 h-5 text-muted-foreground mr-2" />
          <span className="font-semibold">{currentChannel.name}</span>
          {currentChannel.type === 'text' && (currentChannel.slow_mode_seconds ?? 0) > 0 && (
            <span className="ml-3 rounded bg-[#5865f2]/15 px-2 py-0.5 text-xs text-[#949cf7]">
              РњРµРґР»РµРЅРЅС‹Р№ СЂРµР¶РёРј: {formatSlowModeLabel(currentChannel.slow_mode_seconds ?? 0)}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <Tooltip content={showUserSidebar ? 'РЎРєСЂС‹С‚СЊ СЃРїРёСЃРѕРє СѓС‡Р°СЃС‚РЅРёРєРѕРІ' : 'РџРѕРєР°Р·Р°С‚СЊ СЃРїРёСЃРѕРє СѓС‡Р°СЃС‚РЅРёРєРѕРІ'}>
            <button
              className="interactive-row flex items-center p-2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowUserSidebar(!showUserSidebar)}
              aria-label={showUserSidebar ? 'РЎРєСЂС‹С‚СЊ СЃРїРёСЃРѕРє СѓС‡Р°СЃС‚РЅРёРєРѕРІ' : 'РџРѕРєР°Р·Р°С‚СЊ СЃРїРёСЃРѕРє СѓС‡Р°СЃС‚РЅРёРєРѕРІ'}
            >
              <Users className="w-6 h-6 text-muted-foreground" />
            </button>
          </Tooltip>
        </div>
      </div>



      {/* Messages */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={messagesContainerRef}
          className="chat-scroll h-full overflow-y-auto px-5 py-4"
          onScroll={handleMessagesScroll}
        >
          <div ref={messagesContentRef} className="space-y-1">
            {chatLoading && messages.length === 0 && (
              <div className="text-center text-muted-foreground py-4">
                Загрузка истории сообщений...
              </div>
            )}

            {isLoadingOlder && (
              <div className="py-2 text-center text-xs text-muted-foreground">
                Загрузка старых сообщений...
              </div>
            )}

            {!hasMoreOlder && messages.length > 0 && !chatLoading && (
              <div className="py-3 text-center text-xs text-muted-foreground/70">
                Р­С‚Рѕ РЅР°С‡Р°Р»Рѕ РєР°РЅР°Р»Р°
              </div>
            )}
            
            {chatError && (
              <div className="text-center text-red-400 py-4">
                {chatError}
              </div>
            )}
            
            {messages.map((msg, index) => {
              const prevMsg = messages[index - 1];
              const showAuthor = !prevMsg || prevMsg.author.id !== msg.author.id || (new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) > 5 * 60 * 1000;
              const showDateDivider =
                !prevMsg ||
                new Date(prevMsg.timestamp).toDateString() !== new Date(msg.timestamp).toDateString();

              return (
                <React.Fragment key={msg.id}>
                  {showDateDivider && (
                    <div className="date-divider">
                      <span>
                        {formatDateDivider(msg.timestamp)}
                      </span>
                    </div>
                  )}
                  <ChatMessage
                    message={msg}
                    showAuthor={showAuthor}
                    onReply={handleReply}
                    onReaction={handleReaction}
                    currentUser={user || undefined}
                    resolveMentionLabel={resolveMentionLabel}
                    onMentionClick={handleMentionClick}
                    authorColor={getMemberColor(msg.author?.id)}
                    replyAuthorColor={getMemberColor(msg.reply_to?.author?.id)}
                  />
                </React.Fragment>
              )
            })}
            {user && outgoingMessages.map((message) => (
            <OutgoingMessageCard key={message.clientNonce} message={message} author={user} />
          ))}
          <div ref={messagesEndRef} />
          </div>
        </div>

        {currentChannel.type === 'text' && channelMentions.length > 0 && (
          <Tooltip content="РџРµСЂРµР№С‚Рё Рє СѓРїРѕРјРёРЅР°РЅРёСЋ">
            <button
              type="button"
              onClick={handleJumpToMention}
              className="absolute bottom-4 right-4 z-20 flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-[#5865f2] px-3 text-sm font-bold text-white shadow-lg transition hover:bg-[#4752c4] active:scale-95"
              aria-label="РџРµСЂРµР№С‚Рё Рє СѓРїРѕРјРёРЅР°РЅРёСЋ"
            >
              <AtSign className="h-4 w-4" />
              <span>{formatMentionBadge(channelMentions.length)}</span>
            </button>
          </Tooltip>
        )}
      </div>
      
      <TypingIndicator />

      {/* Reply Input */}
      <ReplyInput replyingTo={replyingTo} onCancelReply={handleCancelReply} />

      {/* Message Input */}
      {currentChannel.type === 'text' && (
        <div className="flex-shrink-0 border-t border-border/70 p-3">
          {isSlowModeActive && (
            <div className="mb-2 rounded-md border border-[#5865f2]/30 bg-[#5865f2]/10 px-3 py-2 text-sm text-[#dbdee1]">
              {sendLimitHint ||
                `РџРѕРґРѕР¶РґРёС‚Рµ ${slowModeRemainingSeconds} СЃРµРє. вЂ” РІ СЌС‚РѕРј РєР°РЅР°Р»Рµ РІРєР»СЋС‡С‘РЅ РјРµРґР»РµРЅРЅС‹Р№ СЂРµР¶РёРј.`}
            </div>
          )}
          <form onSubmit={handleSendMessage} className="relative flex flex-col rounded-xl border border-[#3e3f45] bg-[#393a41] p-2">
            {attachmentError && (
              <div className="mb-2 rounded-lg border border-[#da373c]/40 bg-[#da373c]/10 px-3 py-2 text-xs text-[#ffb8ba]">
                {attachmentError}
              </div>
            )}
            {mentionQuery && (
              <MentionAutocomplete
                candidates={filteredMentions}
                selectedIndex={mentionIndex}
                onSelect={applyMention}
                onHover={setMentionIndex}
              />
            )}
            
            {/* File Previews */}
            {files.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto border-b border-border p-2">
                {files.map((file, index) => (
                  <PendingAttachmentPreview
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    file={file}
                    onRemove={() => handleRemoveFile(index)}
                  />
                ))}
              </div>
            )}
            
            <div className="flex items-center">
              <input 
                type="file"
                ref={fileInputRef}
                multiple
                accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button 
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                className="mr-2"
                disabled={files.length >= MAX_CHAT_ATTACHMENTS || isLoading || isSlowModeActive}
                title="РџСЂРёРєСЂРµРїРёС‚СЊ РёР·РѕР±СЂР°Р¶РµРЅРёСЏ РёР»Рё РІРёРґРµРѕ"
              >
                <PlusCircle className="w-5 h-5" />
              </Button>
              <input
                ref={messageInputRef}
                type="text"
                value={messageInput}
                onChange={handleInputChange}
                onPaste={handlePaste}
                onKeyDown={handleInputKeyDown}
                onClick={(e) => {
                  const target = e.currentTarget
                  updateMentionState(target.value, target.selectionStart ?? target.value.length)
                }}
                onKeyUp={(e) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                    const target = e.currentTarget
                    updateMentionState(target.value, target.selectionStart ?? target.value.length)
                  }
                }}
                placeholder={
                  replyingTo 
                    ? `Ответ пользователю ${replyingTo.author.username}...`
                    : `Написать в #${currentChannel.name} · @ — упомянуть`
                }
                className="flex-1 bg-transparent outline-none text-sm"
                disabled={isLoading || isSlowModeActive}
                autoComplete="off"
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={(!messageInput.trim() && files.length === 0) || isLoading || isSlowModeActive}
              >
                {isLoading ? '...' : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </form>
        </div>
      )}

      {currentChannel.type === 'voice' && (
        <div className="p-4 text-center text-muted-foreground">
          <p>Голосовой канал: {currentChannel.name}</p>
          <p className="text-sm">Нажмите на канал для подключения к голосовому чату</p>
        </div>
      )}

      {profilePopover && currentServer && (
        <MemberProfilePopover
          member={profilePopover.member}
          serverId={currentServer.id}
          roles={serverRoles}
          anchorRect={profilePopover.anchorRect}
          onClose={() => setProfilePopover(null)}
          onMemberUpdated={handleProfileMemberUpdated}
        />
      )}
    </div>
  )
}

