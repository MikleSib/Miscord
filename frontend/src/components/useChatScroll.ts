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

export function useChatScroll({ model }: { model: any }) {
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
    user, token, messages, isLoadingOlder, hasMoreOlder, error, chatLoading,
    loadMessageHistory, loadOlderMessages, ensureMessageLoaded, addMessage, updateMessageReactions, updateSingleReaction,
    deleteMessage, editMessage, pinnedMessages, pinnedIds, canManagePins, pinsError,
    setPinned
  } = model
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
        .then((added: boolean) => {
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
      const accessToken = token;

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
            setTypingUsers((prev: string[]) => {
              if (!prev.includes(data.user.username)) {
                const newUsers = [...prev, data.user.username];
                setTimeout(() => {
                  setTypingUsers((current: string[]) => current.filter((u: string) => u !== data.user.username));
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

  /** Догружает историю канала, если сообщение ещё не в списке, и подсвечивает его. */
  const jumpToMessage = useCallback(async (messageId: number) => {
    if (scrollToMention(messageId)) return true

    const loaded = await ensureMessageLoaded(messageId)
    if (!loaded) return false

    // Ждём отрисовку догруженной страницы
    return new Promise<boolean>((resolve) => {
      requestAnimationFrame(() => resolve(scrollToMention(messageId)))
    })
  }, [ensureMessageLoaded, scrollToMention])

  useEffect(() => {
    if (!pendingMessageJump || pendingMessageJump.channelId !== currentChannel?.id) return
    void jumpToMessage(pendingMessageJump.messageId).finally(clearMessageJump)
  }, [clearMessageJump, currentChannel?.id, jumpToMessage, pendingMessageJump])

  const handleJumpToSearchResult = useCallback(async (message: SearchResultMessage) => {
    const targetChannelId = message.text_channel_id ?? message.channelId
    if (targetChannelId && targetChannelId !== currentChannel?.id) {
      selectChannel(targetChannelId, 'text')
      // Канал переключился — история грузится заново, ждём её перед прыжком
      window.setTimeout(() => void jumpToMessage(message.id), 450)
      return
    }
    await jumpToMessage(message.id)
  }, [currentChannel?.id, jumpToMessage, selectChannel])

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
  return {
    slowModeRemainingSeconds, isSlowModeActive, scrollMessagesToBottom,
    handleMessagesScroll, scrollToMention, jumpToMessage,
    handleJumpToSearchResult, handleJumpToMention,
  }
}
