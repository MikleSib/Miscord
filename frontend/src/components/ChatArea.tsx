'use client'

import React from 'react'
import { ChatAreaView } from './ChatAreaView'
import { useChatScroll } from './useChatScroll'
import { useChatComposerActions } from './useChatComposerActions'
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { ChevronRight, Hash, Send, PlusCircle, Pin, X, Users, AtSign } from 'lucide-react'
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
import { useCommunityStore } from '../store/communityStore'
import { PollComposerButton } from './community/PollComposerButton'
import { MemberProfilePopover } from './MemberProfilePopover'
import { Message, Role, ServerMember } from '../types'
import { formatDateDivider } from '../lib/utils'
import chatService from '../services/chatService'
import { appendChatFiles, MAX_CHAT_ATTACHMENTS } from '../lib/chatAttachments'
import { resetChatComposer, resizeChatComposer } from '../lib/chatComposer'
import { PendingAttachmentPreview } from './PendingAttachmentPreview'
import { OutgoingMessageCard } from './OutgoingMessageCard'
import { useOutgoingMessageStore } from '../store/outgoingMessageStore'
import { useChatComposerIntentStore } from '../store/chatComposerIntentStore'
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
import { useComposerFormatting } from '../hooks/useComposerFormatting'
import { ComposerEmojiButton } from './emoji/ComposerEmojiButton'
import { usePinnedMessages } from './pins/usePinnedMessages'
import { ChatAreaHeader } from './chat/ChatAreaHeader'
import type { SearchResultMessage } from '../services/searchService'
import { EmojiAutocomplete } from './emoji/EmojiAutocomplete'
import { useShortcodeAutocomplete } from './emoji/useShortcodeAutocomplete'
import { AttachmentDropOverlay } from './AttachmentDropOverlay'
import { usePersistentMessageDraft } from '../hooks/usePersistentMessageDraft'
import { messageStateService } from '../services/messageStateService'
import { useTextChannelPermissions } from '../hooks/useTextChannelPermissions'

const localizedCommandName = (command: MiscordApplicationCommand) => command.name_localizations?.ru || command.name

export function ChatArea({ showUserSidebar, setShowUserSidebar }: { showUserSidebar: boolean, setShowUserSidebar: (v: boolean) => void }) {
  const { currentChannel, currentServer, selectChannel } = useStore()
  const openThreadDraft = useCommunityStore((state) => state.openThreadDraft)
  const pendingMessageJump = useCommunityStore((state) => state.pendingMessageJump)
  const clearMessageJump = useCommunityStore((state) => state.clearMessageJump)
  const { user, token } = useAuthStore()
  const viewport = useResponsiveLayout()
  const {
    messages,
    isLoading: chatLoading,
    isRefreshing: chatRefreshing,
    isLoadingOlder,
    hasMoreOlder,
    error: chatError,
    loadMessageHistory,
    loadOlderMessages,
    ensureMessageLoaded,
    addMessage,
    updateMessageReactions,
    updateSingleReaction,
    deleteMessage,
    editMessage,
    setCacheOwner,
    activateChannel,
  } = useChatStore()

  useLayoutEffect(() => {
    setCacheOwner(user?.id ?? null)
  }, [setCacheOwner, user?.id])

  useLayoutEffect(() => {
    activateChannel(currentChannel?.type === 'text' ? currentChannel.id : null)
  }, [activateChannel, currentChannel?.id, currentChannel?.type])

  // Логируем изменения currentChannel
  useEffect(() => {
  }, [currentChannel]);

  const [messageInput, setMessageInput] = useState('')
  usePersistentMessageDraft(
    currentChannel?.type === 'text' ? currentChannel.id : null,
    messageInput,
    setMessageInput,
  )
  const mentionIntent = useChatComposerIntentStore((state) => state.mention)
  const consumeMentionIntent = useChatComposerIntentStore((state) => state.consumeMention)
  const [showPinnedPanel, setShowPinnedPanel] = useState(false)
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

  useEffect(() => {
    if (currentChannel?.type !== 'text' || !stickToBottomRef.current) return
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage) return
    void messageStateService.markRead(currentChannel.id, lastMessage.id).catch(() => undefined)
  }, [currentChannel?.id, currentChannel?.type, messages])

  useEffect(() => {
    if (!mentionIntent || currentChannel?.type !== 'text' || currentChannel.id !== mentionIntent.channelId) return
    const token = `<@${mentionIntent.userId}> `
    setMessageInput((current) => current ? `${current.trimEnd()} ${token}` : token)
    consumeMentionIntent(mentionIntent.id)
    window.requestAnimationFrame(() => messageInputRef.current?.focus())
  }, [mentionIntent, currentChannel?.id, currentChannel?.type, consumeMentionIntent])

  const channelIdForMentions =
    currentChannel?.type === 'text' ? currentChannel.id : null
  const textChannelPermissions = useTextChannelPermissions(
    channelIdForMentions,
    currentServer?.id ?? null,
  )
  const {
    pinnedMessages,
    pinnedIds,
    canManagePins,
    pinsError,
    setPinned,
  } = usePinnedMessages(channelIdForMentions)
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

  const applyFormattingShortcut = useComposerFormatting(messageInputRef, setMessageInput)
  const shortcodeAutocomplete = useShortcodeAutocomplete(
    messageInput,
    messageInputRef,
    setMessageInput,
  )

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

  const {
    slowModeRemainingSeconds, isSlowModeActive, scrollMessagesToBottom,
    handleMessagesScroll, scrollToMention, jumpToMessage,
    handleJumpToSearchResult, handleJumpToMention,
  } = useChatScroll({ model: {
    messageInput, setMessageInput, showPinnedPanel, setShowPinnedPanel, files, setFiles,
    attachmentError, setAttachmentError, isDraggingFiles, setIsDraggingFiles, isLoading, setIsLoading,
    typingUsers, setTypingUsers, replyingTo, setReplyingTo, slowModeUntil, setSlowModeUntil,
    sendLimitHint, setSendLimitHint, mentionMembers, setMentionMembers, serverRoles, setServerRoles,
    mentionQuery, setMentionQuery, mentionIndex, setMentionIndex, applicationCommands, setApplicationCommands,
    slashIndex, setSlashIndex, selectedSlashCommand, setSelectedSlashCommand, autocompleteChoices, setAutocompleteChoices,
    autocompleteIndex, setAutocompleteIndex, profilePopover, setProfilePopover, openThreadDraft, pendingMessageJump,
    clearMessageJump, viewport, outgoingQueue, initializeOutgoingQueue, enqueueOutgoing, outgoingMessages,
    fileInputRef, dragDepthRef, messageInputRef, messagesEndRef, messagesContainerRef, messagesContentRef,
    suppressAutoScrollRef, stickToBottomRef, programmaticScrollRef, loadingOlderLockRef, channelIdForMentions, channelMentions,
    markMentionRead, addMentionNotification, applyFormattingShortcut, shortcodeAutocomplete, mentionCandidates, filteredMentions,
    slashQuery, filteredSlashCommands, applicationNames, autocompleteRequest, mentionNameById, resolveMentionLabel,
    handleMentionClick, getMemberColor, handleProfileMemberUpdated, currentChannel, currentServer, selectChannel,
    user, token, messages, isLoadingOlder, hasMoreOlder, error: chatError, chatLoading, chatRefreshing,
    loadMessageHistory, loadOlderMessages, ensureMessageLoaded, addMessage, updateMessageReactions, updateSingleReaction,
    deleteMessage, editMessage, pinnedMessages, pinnedIds, canManagePins, pinsError,
    setPinned,
  } })

  const {
    addFiles, handleFileChange, handlePaste, handleDragEnter, handleDragOver,
    handleDragLeave, handleDrop, handleRemoveFile, updateMentionState, applyMention,
    applySlashCommand, applyAutocompleteChoice, parseCommandOptions, handleSendMessage, handleInputChange,
    handleInputKeyDown,
  } = useChatComposerActions({ model: {
    messageInput, setMessageInput, showPinnedPanel, setShowPinnedPanel, files, setFiles,
    attachmentError, setAttachmentError, isDraggingFiles, setIsDraggingFiles, isLoading, setIsLoading,
    typingUsers, setTypingUsers, replyingTo, setReplyingTo, slowModeUntil, setSlowModeUntil,
    sendLimitHint, setSendLimitHint, mentionMembers, setMentionMembers, serverRoles, setServerRoles,
    mentionQuery, setMentionQuery, mentionIndex, setMentionIndex, applicationCommands, setApplicationCommands,
    slashIndex, setSlashIndex, selectedSlashCommand, setSelectedSlashCommand, autocompleteChoices, setAutocompleteChoices,
    autocompleteIndex, setAutocompleteIndex, profilePopover, setProfilePopover, openThreadDraft, pendingMessageJump,
    clearMessageJump, viewport, outgoingQueue, initializeOutgoingQueue, enqueueOutgoing, outgoingMessages,
    fileInputRef, dragDepthRef, messageInputRef, messagesEndRef, messagesContainerRef, messagesContentRef,
    suppressAutoScrollRef, stickToBottomRef, programmaticScrollRef, loadingOlderLockRef, channelIdForMentions, channelMentions,
    markMentionRead, addMentionNotification, applyFormattingShortcut, shortcodeAutocomplete, mentionCandidates, filteredMentions,
    slashQuery, filteredSlashCommands, applicationNames, autocompleteRequest, mentionNameById, resolveMentionLabel,
    handleMentionClick, getMemberColor, handleProfileMemberUpdated, currentChannel, currentServer, selectChannel,
    user, token, messages, isLoadingOlder, hasMoreOlder, error: chatError, chatLoading, chatRefreshing,
    loadMessageHistory, loadOlderMessages, ensureMessageLoaded, addMessage, updateMessageReactions, updateSingleReaction,
    deleteMessage, editMessage, pinnedMessages, pinnedIds, canManagePins, pinsError,
    setPinned, slowModeRemainingSeconds, isSlowModeActive, scrollMessagesToBottom, handleMessagesScroll, scrollToMention,
    jumpToMessage, handleJumpToSearchResult, handleJumpToMention,
    canSendMessages: textChannelPermissions.canSendMessages,
  } })

  const handleReply = (message: Message) => {
    if (!textChannelPermissions.canSendMessages) return
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

  return <ChatAreaView model={{
    currentChannel, currentServer, showUserSidebar, setShowUserSidebar, pinnedMessages, canManagePins, pinsError,
    setPinned, chatLoading, chatRefreshing, messages, isLoadingOlder, hasMoreOlder, chatError, user, pinnedIds,
    messageInput, setMessageInput, showPinnedPanel, setShowPinnedPanel, files, setFiles,
    attachmentError, setAttachmentError, isDraggingFiles, setIsDraggingFiles, isLoading, setIsLoading,
    typingUsers, setTypingUsers, replyingTo, setReplyingTo, slowModeUntil, setSlowModeUntil,
    sendLimitHint, setSendLimitHint, mentionMembers, setMentionMembers, serverRoles, setServerRoles,
    mentionQuery, setMentionQuery, mentionIndex, setMentionIndex, applicationCommands, setApplicationCommands,
    slashIndex, setSlashIndex, selectedSlashCommand, setSelectedSlashCommand, autocompleteChoices, setAutocompleteChoices,
    autocompleteIndex, setAutocompleteIndex, profilePopover, setProfilePopover, openThreadDraft, pendingMessageJump,
    clearMessageJump, viewport, outgoingQueue, initializeOutgoingQueue, enqueueOutgoing, outgoingMessages,
    fileInputRef, dragDepthRef, messageInputRef, messagesEndRef, messagesContainerRef, messagesContentRef,
    suppressAutoScrollRef, stickToBottomRef, programmaticScrollRef, loadingOlderLockRef, channelIdForMentions, channelMentions,
    markMentionRead, addMentionNotification, applyFormattingShortcut, shortcodeAutocomplete, mentionCandidates, filteredMentions,
    slashQuery, filteredSlashCommands, applicationNames, autocompleteRequest, mentionNameById, resolveMentionLabel,
    handleMentionClick, getMemberColor, handleProfileMemberUpdated, slowModeRemainingSeconds, isSlowModeActive, scrollMessagesToBottom,
    handleMessagesScroll, scrollToMention, jumpToMessage, handleJumpToSearchResult, handleJumpToMention, addFiles,
    handleFileChange, handlePaste, handleDragEnter, handleDragOver, handleDragLeave, handleDrop,
    handleRemoveFile, updateMentionState, applyMention, applySlashCommand, applyAutocompleteChoice, parseCommandOptions,
    handleSendMessage, handleInputChange, handleInputKeyDown, handleReply, handleContextApplicationCommand, handleCancelReply,
    handleReaction, TypingIndicator,
    canSendMessages: textChannelPermissions.canSendMessages,
    channelPermissionStatus: textChannelPermissions.status,
    refreshChannelPermissions: textChannelPermissions.refresh,
  }} />
}
