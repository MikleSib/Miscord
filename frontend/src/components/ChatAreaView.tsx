'use client'

import React from 'react'
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
import { ChannelWelcome } from './chat/ChannelWelcome'
import { ChatMessageListSkeleton } from './chat/ChatMessageListSkeleton'
import { Permissions } from '../lib/permissions'
import { useServerPermissions } from '../lib/serverPermissions'
import { requestChannelSettings } from '../lib/channelSettingsEvents'
import { MessageComposerUnavailable } from './chat/MessageComposerUnavailable'
import { ExpressionComposerButton } from './media/ExpressionComposerButton'

const localizedCommandName = (command: MiscordApplicationCommand) => command.name_localizations?.ru || command.name

export function ChatAreaView({ model }: { model: any }) {
  const {
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
    handleReaction, TypingIndicator, canSendMessages, channelPermissionStatus, refreshChannelPermissions,
    handleExpressionEmoji, sendExpressionMedia
  } = model
  const { can } = useServerPermissions(currentServer?.id ?? null)
  const isStandardTextChannel = currentChannel.type === 'text'
    && (!currentChannel.kind || currentChannel.kind === 'text')

  return (
    <div
      className="chat-area relative flex h-full min-w-0 flex-1 flex-col bg-background"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFiles && canSendMessages && <AttachmentDropOverlay />}
      <ChatAreaHeader
        channel={currentChannel}
        serverId={currentServer?.id ?? null}
        showUserSidebar={showUserSidebar}
        onToggleUserSidebar={() => setShowUserSidebar(!showUserSidebar)}
        showPinnedPanel={showPinnedPanel}
        onTogglePinnedPanel={() => setShowPinnedPanel((previous: boolean) => !previous)}
        onClosePinnedPanel={() => setShowPinnedPanel(false)}
        pinnedMessages={pinnedMessages}
        canManagePins={canManagePins}
        pinsError={pinsError}
        onUnpin={(messageId) => void setPinned(messageId, false)}
        onJumpToMessage={scrollToMention}
        onJumpToSearchResult={(message) => void handleJumpToSearchResult(message)}
      />


      {/* Messages */}
      <div className="relative min-h-0 flex-1">
        {chatRefreshing && messages.length > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/15"
            role="status"
            aria-label="Обновление сообщений"
          >
            <div className="h-full w-1/3 animate-pulse bg-primary motion-reduce:animate-none" />
          </div>
        )}
        <div
          ref={messagesContainerRef}
          className="chat-scroll chat-area-messages h-full overflow-y-auto px-5 py-4"
          onScroll={handleMessagesScroll}
        >
          <div ref={messagesContentRef} className="space-y-1">
            {chatLoading && messages.length === 0 && (
              <ChatMessageListSkeleton />
            )}

            {isLoadingOlder && (
              <div className="py-2 text-center text-xs text-muted-foreground">
                Загрузка старых сообщений...
              </div>
            )}

            {!hasMoreOlder && !chatLoading && !chatError && isStandardTextChannel && (
              <ChannelWelcome
                channelName={currentChannel.name}
                canManage={can(Permissions.MANAGE_CHANNELS)}
                onConfigure={() => requestChannelSettings(currentChannel)}
              />
            )}

            {chatError && (
              <div className="text-center text-red-400 py-4">
                {chatError}
              </div>
            )}

            {messages.map((msg: Message, index: number) => {
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
                    applicationCommands={applicationCommands.commands.filter((command: MiscordApplicationCommand) => command.type === 2 || command.type === 3)}
                    onApplicationCommand={handleContextApplicationCommand}
                    isPinned={pinnedIds.has(msg.id)}
                    canPin={canManagePins}
                    onTogglePin={setPinned}
                    onCreateThread={(message) => openThreadDraft(currentChannel.id, message)}
                  />
                </React.Fragment>
              )
            })}
            {user && outgoingMessages.map((message: any, index: number) => {
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
              className="absolute bottom-4 right-4 z-20 flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-sm font-bold text-white shadow-lg transition hover:bg-brand-hover active:scale-95"
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
      {canSendMessages && (
        <ReplyInput replyingTo={replyingTo} onCancelReply={handleCancelReply} />
      )}

      {/* Message Input */}
      {currentChannel.type === 'text' && canSendMessages && (
        <div className="chat-area-composer flex-shrink-0 border-t border-border/70 p-3">
          {isSlowModeActive && (
            <div className="mb-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-text-body">
              {sendLimitHint ||
                `Подождите ${slowModeRemainingSeconds} сек. — в этом канале включён медленный режим.`}
            </div>
          )}
          <form onSubmit={handleSendMessage} className="chat-area-composer__surface relative flex flex-col rounded-xl border border-gray-700 bg-gray-800 p-2">
            {attachmentError && (
              <div className="mb-2 rounded-lg border border-[#da373c]/40 bg-destructive/10 px-3 py-2 text-xs text-[#ffb8ba]">
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
            {!mentionQuery && (
              <EmojiAutocomplete
                entries={shortcodeAutocomplete.entries}
                selectedIndex={shortcodeAutocomplete.selectedIndex}
                onSelect={shortcodeAutocomplete.apply}
                onHover={shortcodeAutocomplete.setSelectedIndex}
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
              <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-40 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-surface p-2 shadow-2xl shadow-black/40">
                <div className="px-2 pb-2 pt-1 text-[11px] font-bold uppercase tracking-wider text-text-quiet">Варианты параметра</div>
                {autocompleteChoices.map((choice: ApplicationCommandChoice, index: number) => (
                  <button
                    key={`${choice.name}-${String(choice.value)}-${index}`}
                    type="button"
                    onMouseDown={(event) => { event.preventDefault(); applyAutocompleteChoice(choice) }}
                    onMouseEnter={() => setAutocompleteIndex(index)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${index === autocompleteIndex ? 'bg-primary text-white' : 'text-text-body hover:bg-[#35373c]'}`}
                  >
                    <span className="min-w-0 truncate font-medium">{choice.name}</span>
                    <span className={`max-w-[45%] truncate text-xs ${index === autocompleteIndex ? 'text-white/75' : 'text-text-quiet'}`}>{String(choice.value)}</span>
                  </button>
                ))}
              </div>
            )}

            {/* File Previews */}
            {files.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto border-b border-border p-2">
                {files.map((file: File, index: number) => (
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
                aria-label="Прикрепить файлы"
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
                      ? `Сообщение #${currentChannel.name}`
                      : `Написать в #${currentChannel.name} · / — команда · @ — упомянуть`
                }
                className="chat-area-composer__input min-w-0 flex-1 bg-transparent text-sm outline-none"
                disabled={isLoading || isSlowModeActive}
                autoComplete="off"
              />
              <ComposerEmojiButton
                inputRef={messageInputRef}
                setValue={setMessageInput}
                disabled={isLoading || isSlowModeActive}
                className="mr-1"
              />
              <ExpressionComposerButton
                serverId={currentServer?.id}
                disabled={isLoading || isSlowModeActive}
                onEmoji={handleExpressionEmoji}
                onSticker={(id) => sendExpressionMedia({ stickerIds: [id] })}
                onGif={(gif) => sendExpressionMedia({ gif })}
              />
              <PollComposerButton channelId={currentChannel.id} disabled={isLoading || isSlowModeActive} />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="chat-area-composer__send h-11 w-11"
                aria-label="Отправить сообщение"
                disabled={(!messageInput.trim() && files.length === 0) || isLoading || isSlowModeActive}
              >
                {isLoading ? '...' : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </form>
        </div>
      )}

      {currentChannel.type === 'text' && !canSendMessages && (
        <MessageComposerUnavailable
          status={channelPermissionStatus}
          onRetry={refreshChannelPermissions}
        />
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
