'use client'

import React from 'react'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ChevronRight, Hash, Send, PlusCircle, X, Users, AtSign } from 'lucide-react'
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
import { SlashCommandAutocomplete } from './SlashCommandAutocomplete'
import { InteractionModalHost } from './InteractionModalHost'
import { MemberProfilePopover } from './MemberProfilePopover'
import { Message, Role, ServerMember } from '../types'
import { formatDateDivider } from '../lib/utils'
import chatService from '../services/chatService'
import { appendChatFiles, MAX_CHAT_ATTACHMENTS } from '../lib/chatAttachments'
import { resetChatComposer, resizeChatComposer } from '../lib/chatComposer'
import { PendingAttachmentPreview } from './PendingAttachmentPreview'
import { OutgoingMessageCard } from './OutgoingMessageCard'
import { useOutgoingMessageStore } from '../store/outgoingMessageStore'
import reactionService from '../services/reactionService'
import serverService from '../services/serverService'
import botService from '../services/botService'
import type { ApplicationCommandChoice, ChannelApplicationCommands, MiscordApplicationCommand, MiscordApplicationCommandOption } from '../types/bot'
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
import { useResponsiveLayout } from '../hooks/useResponsiveLayout'

const localizedCommandName = (command: MiscordApplicationCommand) => command.name_localizations?.ru || command.name

export function ChatArea({ showUserSidebar, setShowUserSidebar }: { showUserSidebar: boolean, setShowUserSidebar: (v: boolean) => void }) {
  const { currentChannel, currentServer } = useStore()
  const { user, token } = useAuthStore()
  const viewport = useResponsiveLayout()
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
  
  // Логируем изменения currentChannel
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
  const [applicationCommands, setApplicationCommands] = useState<ChannelApplicationCommands>({ applications: [], commands: [] })
  const [slashIndex, setSlashIndex] = useState(0)
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<MiscordApplicationCommand | null>(null)
  const [autocompleteChoices, setAutocompleteChoices] = useState<ApplicationCommandChoice[]>([])
  const [autocompleteIndex, setAutocompleteIndex] = useState(0)
  const [profilePopover, setProfilePopover] = useState<{
    member: ServerMember
    anchorRect: DOMRect
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)
  const suppressAutoScrollRef = useRef(false)
  /** Держим низ чата, пока пользователь сам не ушёл вверх читать историю */
  const stickToBottomRef = useRef(true)
  /** Игнорим onScroll пока сами прыгаем вниз (иначе stick сбрасывается) */
  const programmaticScrollRef = useRef(false)
  /** Чтобы скролл вверх не запросил одну пачку несколько раз подряд */
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

  const slashQuery = useMemo(() => {
    if (!messageInput.startsWith('/') || messageInput.includes('\n') || /^\/[^\s]+\s/.test(messageInput)) return null
    const match = messageInput.match(/^\/([^\s]*)/)
    return match ? match[1].toLocaleLowerCase() : null
  }, [messageInput])

  const filteredSlashCommands = useMemo(() => {
    if (slashQuery === null) return []
    return applicationCommands.commands
      .filter((command) => command.type === 1 && (
        command.name.toLocaleLowerCase().includes(slashQuery)
        || localizedCommandName(command).toLocaleLowerCase().includes(slashQuery)
      ))
      .slice(0, 25)
  }, [applicationCommands.commands, slashQuery])

  const applicationNames = useMemo(
    () => Object.fromEntries(applicationCommands.applications.map((application) => [application.id, application.name])),
    [applicationCommands.applications],
  )

  const autocompleteRequest = useMemo(() => {
    if (!selectedSlashCommand) return null
    const visibleName = localizedCommandName(selectedSlashCommand)
    if (!messageInput.startsWith(`/${visibleName} `)) return null
    const source = messageInput.slice(visibleName.length + 2)
    const rawTokens = source.match(/"[^"]*"|'[^']*'|\S+/g) || []
    const optionIndex = source.endsWith(' ') ? rawTokens.length : Math.max(0, rawTokens.length - 1)
    const option = (selectedSlashCommand.options || [])[optionIndex]
    if (!option?.autocomplete) return null
    const tokens = rawTokens.map((token) => token.replace(/^("|')|("|')$/g, ''))
    const value = source.endsWith(' ') ? '' : (tokens[optionIndex] || '')
    const options = (selectedSlashCommand.options || []).slice(0, optionIndex + 1).map((definition, index) => ({
      name: definition.name,
      type: definition.type,
      value: index === optionIndex ? value : tokens[index] || '',
      ...(index === optionIndex ? { focused: true } : {}),
    }))
    return { command: selectedSlashCommand, optionIndex, tokens, options }
  }, [messageInput, selectedSlashCommand])

  useEffect(() => {
    if (currentChannel?.type !== 'text') {
      setApplicationCommands({ applications: [], commands: [] })
      return
    }
    let cancelled = false
    botService.listChannelCommands(currentChannel.id)
      .then((result) => { if (!cancelled) setApplicationCommands(result) })
      .catch(() => { if (!cancelled) setApplicationCommands({ applications: [], commands: [] }) })
    return () => { cancelled = true }
  }, [currentChannel?.id, currentChannel?.type])

  useEffect(() => {
    if (!autocompleteRequest || currentChannel?.type !== 'text') {
      setAutocompleteChoices([])
      setAutocompleteIndex(0)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      botService.autocompleteCommand(
        currentChannel.id,
        autocompleteRequest.command.application_id,
        autocompleteRequest.command.id,
        {
          name: autocompleteRequest.command.name,
          type: autocompleteRequest.command.type,
          options: autocompleteRequest.options,
        },
      ).then((result) => {
        if (cancelled) return
        setAutocompleteChoices(result.choices)
        setAutocompleteIndex(0)
      }).catch(() => {
        if (!cancelled) setAutocompleteChoices([])
      })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [autocompleteRequest, currentChannel?.id, currentChannel?.type])

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

  // Список участников и ролей — для @упоминаний и карточки профиля
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
        console.error('Не удалось загрузить участников для упоминаний:', error)
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

  /** Цвет ника участника по роли (как в списке справа) */
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

  // Зашли в канал — всегда начинаем с последних сообщений (низ)
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
      // Мгновенно — иначе при куче сообщений smooth «ломается» и остаёшься наверху
      container.scrollTop = container.scrollHeight
    }
    // На всякий случай якорь в конце списка
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })
    // Даём браузеру применить scrollTop, потом снова слушаем onScroll
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

    // При прокрутке вверх подгружаем следующую пачку старых сообщений
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
          // Сохраняем позицию глаз: после prepend не прыгаем
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

  // Пока «прилипли» к низу — любой рост высоты (превью, картинки) снова кидает вниз
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

  // Загрузка истории сообщений при смене канала
  useEffect(() => {
    if (currentChannel?.type === 'text') {
      stickToBottomRef.current = true
      loadMessageHistory(currentChannel.id);
      
      // Подключаемся к WebSocket чата только если еще не подключены
      const accessToken = token || localStorage.getItem('access_token');
      
      if (accessToken) {
        
        // Обработчик новых сообщений
        chatService.onMessage((msg) => {
          // Адаптируем Message к ChatMessage
          const chatMessage = {
            ...msg,
            content: msg.content || '', // Гарантируем что content не null
          };
          addMessage(chatMessage);

          // Если в сообщении пинг текущего пользователя — кладём в непрочитанные
          // (дедуп со звуком уже внутри store; событие mention тоже может прийти)
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
        
        // Обработчик печати
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

        // Обработчик удаления сообщений
        chatService.onMessageDeleted((data) => {
          deleteMessage(data.message_id);
        });

        // Обработчик редактирования сообщений
        chatService.onMessageEdited((msg) => {
          editMessage(msg.id, msg.content || '');
        });

        // Обработчик обновления реакций
        chatService.onReactionUpdated((data) => {
          updateSingleReaction(data.message_id, data.emoji, data.reaction);
        });

        chatService.onSlowMode((data) => {
          if (data.text_channel_id !== currentChannel.id) return;
          setSlowModeUntil(Date.now() + data.retry_after_seconds * 1000);
          setSendLimitHint(
            `Подождите ${data.retry_after_seconds} сек. — в этом канале включён медленный режим.`
          );
        });

        chatService.onRateLimit((data) => {
          if (data.text_channel_id && data.text_channel_id !== currentChannel.id) return;
          const seconds = Math.max(1, data.retry_after_seconds || 1);
          setSlowModeUntil(Date.now() + seconds * 1000);
          setSendLimitHint(
            data.message
              ? `${data.message} (${seconds} сек.)`
              : `Слишком быстро. Подождите ${seconds} сек.`
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

  // После загрузки/новых сообщений — прыгаем вниз (и при F5 / смене канала)
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

    // Несколько попыток: после paint, после layout и после превью/картинок
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

  /** Каждый клик ведёт к следующему непрочитанному упоминанию. */
  const handleJumpToMention = useCallback(() => {
    const target = channelMentions[0]
    if (!target) return

    if (!scrollToMention(target.messageId)) {
      // Сообщения нет в загруженной истории — снимаем, чтобы не застревать
      markMentionRead(target.messageId)
    }
    // Прочитанным станет само сообщение, когда оно окажется на экране (и фон плавно погаснет)
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

  const applySlashCommand = (command: MiscordApplicationCommand) => {
    setSelectedSlashCommand(command)
    setMessageInput(`/${localizedCommandName(command)}${command.options?.length ? ' ' : ''}`)
    setSlashIndex(0)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      const input = messageInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
      resizeChatComposer(input)
    })
  }

  const applyAutocompleteChoice = (choice: ApplicationCommandChoice) => {
    if (!autocompleteRequest) return
    const value = String(choice.value)
    const serialized = /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
    const tokens = [...autocompleteRequest.tokens]
    tokens[autocompleteRequest.optionIndex] = serialized
    const next = `/${localizedCommandName(autocompleteRequest.command)} ${tokens.join(' ')} `
    setMessageInput(next)
    setAutocompleteChoices([])
    setAutocompleteIndex(0)
    requestAnimationFrame(() => {
      const input = messageInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(next.length, next.length)
      resizeChatComposer(input)
    })
  }

  const parseCommandOptions = (command: MiscordApplicationCommand, source: string) => {
    const tokens = source.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^("|')|("|')$/g, '')) || []
    const definitions = command.options || []
    return definitions.slice(0, tokens.length).map((option: MiscordApplicationCommandOption, index) => {
      const raw = tokens[index]
      let value: string | number | boolean = raw
      if (option.type === 4) value = Number.parseInt(raw, 10)
      if (option.type === 10) value = Number.parseFloat(raw)
      if (option.type === 5) value = ['true', '1', 'yes', 'да'].includes(raw.toLocaleLowerCase())
      return { name: option.name, type: option.type, value }
    })
  }

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault()
    const content = messageInput.trim()
    if ((!content && files.length === 0) || !user || !currentChannel) return

    if (content.startsWith('/') && files.length === 0 && currentChannel.type === 'text') {
      const [commandName, ...argumentParts] = content.slice(1).trim().split(/\s+/)
      const command = selectedSlashCommand && localizedCommandName(selectedSlashCommand) === commandName
        ? selectedSlashCommand
        : applicationCommands.commands.find((item) => item.type === 1 && (item.name === commandName || localizedCommandName(item) === commandName))
      if (command) {
        const required = (command.options || []).filter((option) => option.required).length
        if (argumentParts.length < required) {
          setAttachmentError(`Для /${command.name} нужно указать обязательные параметры.`)
          return
        }
        setIsLoading(true)
        setAttachmentError(null)
        try {
          const result = await botService.invokeCommand(currentChannel.id, command.application_id, command.id, {
            name: command.name,
            type: command.type,
            options: parseCommandOptions(command, argumentParts.join(' ')),
          })
          if (result.status === 'offline' || result.status === 'failed') {
            setAttachmentError('Приложение сейчас недоступно и не получило команду.')
            return
          }
          setMessageInput('')
          setSelectedSlashCommand(null)
          requestAnimationFrame(() => resetChatComposer(messageInputRef.current))
        } catch (requestError) {
          const detail = (requestError as { response?: { data?: { detail?: string } } }).response?.data?.detail
          setAttachmentError(typeof detail === 'string' ? detail : 'Не удалось выполнить команду приложения.')
        } finally {
          setIsLoading(false)
        }
        return
      }
    }

    const queuedFiles = [...files]
    const replyToId = replyingTo?.id
    setMessageInput('')
    requestAnimationFrame(() => {
      resetChatComposer(messageInputRef.current)
    })
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
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const caret = e.target.selectionStart ?? value.length
    setMessageInput(value)
    if (value.startsWith('/')) {
      setMentionQuery(null)
      setSlashIndex(0)
      if (selectedSlashCommand && !value.startsWith(`/${localizedCommandName(selectedSlashCommand)}`)) setSelectedSlashCommand(null)
    } else {
      setSelectedSlashCommand(null)
      updateMentionState(value, caret)
    }
    if (currentChannel?.type === 'text') {
      chatService.sendTyping();
    }
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocompleteChoices.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAutocompleteIndex((previous) => (previous + 1) % autocompleteChoices.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAutocompleteIndex((previous) => (previous - 1 + autocompleteChoices.length) % autocompleteChoices.length)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAutocompleteChoices([])
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
        e.preventDefault()
        applyAutocompleteChoice(autocompleteChoices[autocompleteIndex] || autocompleteChoices[0])
        return
      }
    }
    if (slashQuery !== null && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((previous) => (previous + 1) % filteredSlashCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((previous) => (previous - 1 + filteredSlashCommands.length) % filteredSlashCommands.length)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMessageInput('')
        setSelectedSlashCommand(null)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !messageInput.includes(' '))) {
        e.preventDefault()
        applySlashCommand(filteredSlashCommands[slashIndex] || filteredSlashCommands[0])
        return
      }
    }
    if (!mentionQuery || filteredMentions.length === 0) {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        e.currentTarget.form?.requestSubmit()
      }
      return
    }

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
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
      e.preventDefault()
      applyMention(filteredMentions[mentionIndex] || filteredMentions[0])
    }
  }

  const handleReply = (message: Message) => {
    setReplyingTo(message);
  }

  const handleContextApplicationCommand = async (command: MiscordApplicationCommand, targetMessage: Message) => {
    if (!currentChannel || currentChannel.type !== 'text') return
    setAttachmentError(null)
    try {
      const targetId = command.type === 2 ? targetMessage.author.id : targetMessage.id
      const result = await botService.invokeCommand(currentChannel.id, command.application_id, command.id, {
        name: command.name,
        type: command.type,
        target_id: String(targetId),
      })
      if (result.status === 'offline' || result.status === 'failed') {
        setAttachmentError('Приложение сейчас недоступно и не получило команду.')
      }
    } catch (requestError) {
      const detail = (requestError as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setAttachmentError(typeof detail === 'string' ? detail : 'Не удалось выполнить команду приложения.')
    }
  }

  const handleCancelReply = () => {
    setReplyingTo(null);
  }

  const handleReaction = async (messageId: number, emoji: string) => {
    try {
      // toggleReaction возвращает обновленную реакцию
      const updatedReaction = await reactionService.toggleReaction(messageId, emoji);
      
      // Не обновляем локальное состояние здесь - оно будет обновлено через WebSocket
      // WebSocket получит событие reaction_updated и обновит состояние автоматически
      
      console.log('Реакция обновлена:', emoji, 'на сообщение:', messageId, updatedReaction);
    } catch (error) {
      console.error('Ошибка при изменении реакции:', error);
      
      // Если произошла ошибка, можем попробовать обновить локально
      try {
        const allReactions = await reactionService.getMessageReactions(messageId);
        updateMessageReactions(messageId, allReactions);
      } catch (fallbackError) {
        console.error('Ошибка при получении реакций:', fallbackError);
      }
    }
  }
  
  const TypingIndicator = () => {
    if (typingUsers.length === 0) return null;
    
    let text = '';
    if (typingUsers.length === 1) {
      text = `${typingUsers[0]} печатает...`;
    } else if (typingUsers.length > 1 && typingUsers.length < 4) {
      text = `${typingUsers.join(', ')} печатают...`;
    } else {
      text = 'Несколько человек печатают...';
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
      className="chat-area relative flex h-full min-w-0 flex-1 flex-col bg-background"
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
            <p className="mt-1 text-sm text-[#b5bac1]">Изображения до 10 МиБ, остальные файлы до 20 МиБ</p>
          </div>
        </div>
      )}
      {/* Channel Header */}
      <div className="app-header chat-area-header flex h-12 flex-shrink-0 items-center justify-between border-b px-4">
        <div className="chat-area-header__title flex min-w-0 items-center">
          <Hash className="w-5 h-5 text-muted-foreground mr-2" />
          <span className="truncate font-semibold">{currentChannel.name}</span>
          <ChevronRight className="mobile-channel-chevron ml-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {currentChannel.type === 'text' && (currentChannel.slow_mode_seconds ?? 0) > 0 && (
            <span className="ml-3 rounded bg-[#5865f2]/15 px-2 py-0.5 text-xs text-[#949cf7]">
              Медленный режим: {formatSlowModeLabel(currentChannel.slow_mode_seconds ?? 0)}
            </span>
          )}
        </div>
        <div className="chat-area-header__actions flex items-center space-x-2">
          <Tooltip content={showUserSidebar ? 'Скрыть список участников' : 'Показать список участников'}>
            <button
              className="interactive-row flex items-center p-2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowUserSidebar(!showUserSidebar)}
              aria-label={showUserSidebar ? 'Скрыть список участников' : 'Показать список участников'}
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
          className="chat-scroll chat-area-messages h-full overflow-y-auto px-5 py-4"
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
                Это начало канала
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
                    applicationCommands={applicationCommands.commands.filter((command) => command.type === 2 || command.type === 3)}
                    onApplicationCommand={handleContextApplicationCommand}
                  />
                </React.Fragment>
              )
            })}
            {user && outgoingMessages.map((message, index) => {
              const previousAuthorId = index > 0
                ? user.id
                : messages[messages.length - 1]?.author?.id
              const previousTimestamp = index > 0
                ? outgoingMessages[index - 1]?.createdAt
                : messages[messages.length - 1]?.timestamp
              const elapsed = previousTimestamp
                ? new Date(message.createdAt).getTime() - new Date(previousTimestamp).getTime()
                : Number.POSITIVE_INFINITY
              const grouped = previousAuthorId === user.id && elapsed >= 0 && elapsed < 5 * 60 * 1000

              return <OutgoingMessageCard key={message.clientNonce} message={message} author={user} grouped={grouped} />
            })}
          <div ref={messagesEndRef} />
          </div>
        </div>

        {currentChannel.type === 'text' && channelMentions.length > 0 && (
          <Tooltip content="Перейти к упоминанию">
            <button
              type="button"
              onClick={handleJumpToMention}
              className="absolute bottom-4 right-4 z-20 flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-[#5865f2] px-3 text-sm font-bold text-white shadow-lg transition hover:bg-[#4752c4] active:scale-95"
              aria-label="Перейти к упоминанию"
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
        <div className="chat-area-composer flex-shrink-0 border-t border-border/70 p-3">
          {isSlowModeActive && (
            <div className="mb-2 rounded-md border border-[#5865f2]/30 bg-[#5865f2]/10 px-3 py-2 text-sm text-[#dbdee1]">
              {sendLimitHint ||
                `Подождите ${slowModeRemainingSeconds} сек. — в этом канале включён медленный режим.`}
            </div>
          )}
          <form onSubmit={handleSendMessage} className="chat-area-composer__surface relative flex flex-col rounded-xl border border-[#3e3f45] bg-[#393a41] p-2">
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
            {slashQuery !== null && !mentionQuery && (
              <SlashCommandAutocomplete
                commands={filteredSlashCommands}
                selectedIndex={slashIndex}
                applicationNames={applicationNames}
                onSelect={applySlashCommand}
                onHover={setSlashIndex}
              />
            )}
            {autocompleteChoices.length > 0 && !mentionQuery && (
              <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-40 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-[#2b2d31] p-2 shadow-2xl shadow-black/40">
                <div className="px-2 pb-2 pt-1 text-[11px] font-bold uppercase tracking-wider text-[#949ba4]">Варианты параметра</div>
                {autocompleteChoices.map((choice, index) => (
                  <button
                    key={`${choice.name}-${String(choice.value)}-${index}`}
                    type="button"
                    onMouseDown={(event) => { event.preventDefault(); applyAutocompleteChoice(choice) }}
                    onMouseEnter={() => setAutocompleteIndex(index)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${index === autocompleteIndex ? 'bg-[#5865f2] text-white' : 'text-[#dbdee1] hover:bg-[#35373c]'}`}
                  >
                    <span className="min-w-0 truncate font-medium">{choice.name}</span>
                    <span className={`max-w-[45%] truncate text-xs ${index === autocompleteIndex ? 'text-white/75' : 'text-[#949ba4]'}`}>{String(choice.value)}</span>
                  </button>
                ))}
              </div>
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
            
            <div className="chat-area-composer__row flex items-center">
              <input 
                type="file"
                ref={fileInputRef}
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <Button 
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                className="chat-area-composer__attach mr-2"
                disabled={files.length >= MAX_CHAT_ATTACHMENTS || isLoading || isSlowModeActive}
                title="Прикрепить файлы"
              >
                <PlusCircle className="w-5 h-5" />
              </Button>
              <textarea
                ref={messageInputRef}
                rows={1}
                style={{ resize: 'none', overflowY: 'hidden' }}
                value={messageInput}
                onChange={handleInputChange}
                onPaste={handlePaste}
                onKeyDown={handleInputKeyDown}
                onInput={(e) => resizeChatComposer(e.currentTarget)}
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
                    : viewport === 'phone'
                      ? `Написать в #${currentChannel.name}`
                      : `Написать в #${currentChannel.name} · / — команда · @ — упомянуть`
                }
                className="chat-area-composer__input min-w-0 flex-1 bg-transparent text-sm outline-none"
                disabled={isLoading || isSlowModeActive}
                autoComplete="off"
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="chat-area-composer__send h-8 w-8"
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
      <InteractionModalHost />
    </div>
  )
}

