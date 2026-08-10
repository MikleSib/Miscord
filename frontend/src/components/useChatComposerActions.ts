'use client'

import React from 'react'
import { ChatAreaView } from './ChatAreaView'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
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

const localizedCommandName = (command: MiscordApplicationCommand) => command.name_localizations?.ru || command.name

export function useChatComposerActions({ model }: { model: any }) {
  const {
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
    user, token, messages, isLoadingOlder, hasMoreOlder, error,
    loadMessageHistory, loadOlderMessages, ensureMessageLoaded, addMessage, updateMessageReactions, updateSingleReaction,
    deleteMessage, editMessage, pinnedMessages, pinnedIds, canManagePins, pinsError,
    setPinned, slowModeRemainingSeconds, isSlowModeActive, scrollMessagesToBottom, handleMessagesScroll, scrollToMention,
    jumpToMessage, handleJumpToSearchResult, handleJumpToMention
  } = model
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
    setFiles((prev: File[]) => prev.filter((_: File, i: number) => i !== index));
    setAttachmentError(null)
  }

  const updateMentionState = (value: string, caret: number) => {
    const active = getActiveMentionQuery(value, caret)
    setMentionQuery(active)
    setMentionIndex(0)
    shortcodeAutocomplete.syncCaret(caret)
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
        : applicationCommands.commands.find((item: MiscordApplicationCommand) => item.type === 1 && (item.name === commandName || localizedCommandName(item) === commandName))
      if (command) {
        const required = (command.options || []).filter((option: MiscordApplicationCommandOption) => option.required).length
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
      shortcodeAutocomplete.syncCaret(caret)
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
    if (applyFormattingShortcut(e)) return
    if (!mentionQuery && shortcodeAutocomplete.handleKeyDown(e)) return
    if (autocompleteChoices.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAutocompleteIndex((previous: number) => (previous + 1) % autocompleteChoices.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAutocompleteIndex((previous: number) => (previous - 1 + autocompleteChoices.length) % autocompleteChoices.length)
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
        setSlashIndex((previous: number) => (previous + 1) % filteredSlashCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((previous: number) => (previous - 1 + filteredSlashCommands.length) % filteredSlashCommands.length)
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
      setMentionIndex((prev: number) => (prev + 1) % filteredMentions.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex((prev: number) => (prev - 1 + filteredMentions.length) % filteredMentions.length)
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
  return {
    addFiles, handleFileChange, handlePaste, handleDragEnter, handleDragOver,
    handleDragLeave, handleDrop, handleRemoveFile, updateMentionState, applyMention,
    applySlashCommand, applyAutocompleteChoice, parseCommandOptions, handleSendMessage, handleInputChange,
    handleInputKeyDown,
  }
}
