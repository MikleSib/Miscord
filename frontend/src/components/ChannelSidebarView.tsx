'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Hash, MessageSquare, Volume2, ChevronDown, Settings, Plus, FolderPlus, Mic, MicOff, Headphones, PhoneOff, VolumeX, Monitor, MonitorOff, UserX, UserCheck, Shield, Volume1, LogOut, Copy, UserPlus, Bell, Search } from 'lucide-react'
import { useStore } from '../lib/store'
import { useVoiceStore } from '../store/slices/voiceSlice'
import { useAuthStore } from '../store/store'
import { useRouter } from 'next/navigation'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'
import { Slider } from './ui/slider'
import { UserAvatar } from './ui/user-avatar'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ui/context-menu'
import voiceService from '../services/voiceService'
import optimizedVoiceService from '../services/optimizedVoiceService'
import { useScreenSharePickerStore } from '../store/screenSharePickerStore'
import { Channel, Role, ServerMember } from '../types'
import channelService from '../services/channelService'
import { Permissions } from '../lib/permissions'
import { useServerPermissions } from '../lib/serverPermissions'
import { ServerSettingsModal } from './ServerSettingsModal'
import { ChannelSettingsModal } from './ChannelSettingsModal'
import { CreateChannelModal } from './CreateChannelModal'
import { InvitePeopleModal } from './InvitePeopleModal'
import { ServerNotificationSettingsModal } from './ServerNotificationSettingsModal'

// Компонент для аватарки с анимацией при разговоре
import { SpeakingAvatar } from './SpeakingAvatar'
import { MemberProfilePopover } from './MemberProfilePopover'
import serverService from '../services/serverService'
import { openScreenShareView } from '../lib/screenShareNavigation'
import { StreamHoverPreview } from './StreamHoverPreview'
import {
  useMentionNotificationStore,
  formatMentionBadge,
} from '../store/mentionNotificationStore'
import { useChannelUnreadStore } from '../store/channelUnreadStore'
import { useChannelCategoryStore } from '../store/channelCategoryStore'
import { useChannelCategories } from './channels/useChannelCategories'
import { ChannelGroupList } from './channels/ChannelGroupList'
import { VoiceParticipantList } from './channels/VoiceParticipantList'
import { VoiceParticipantContextMenu } from './voice/VoiceParticipantContextMenu'

export function ChannelSidebarView({ model }: { model: any }) {
  const {
    currentServer, currentVoiceChannelId, isConnecting, user, speakingUsers, categories, updateServer, loadServers,
    isCreateChannelModalOpen, setIsCreateChannelModalOpen, createChannelInitialType, setCreateChannelInitialType, voiceChannelMembers, setVoiceChannelMembers,
    contextMenu, setContextMenu, participantVolumes, setParticipantVolumes, screenSharingUsers, setScreenSharingUsers,
    streamHoverPreview, setStreamHoverPreview, isScreenSharing, setIsScreenSharing, activeSharingUsers, setActiveSharingUsers,
    serverContextMenu, setServerContextMenu, isSettingsModalOpen, setIsSettingsModalOpen, isChannelSettingsModalOpen, setIsChannelSettingsModalOpen,
    isInviteModalOpen, setIsInviteModalOpen, channelSearch, setChannelSearch, isNotificationSettingsOpen, setIsNotificationSettingsOpen,
    selectedChannelForSettings, setSelectedChannelForSettings, hoveredChannel, setHoveredChannel, voiceMemberProfile, setVoiceMemberProfile,
    draggingChannel, setDraggingChannel, dropCategoryKey, setDropCategoryKey, mentionPending, channelUnreadPending,
    canManageChannels, canCreateInvite, canShowInviteButton, router, streamHoverTimerRef, collapsedCategories,
    toggleCategoryCollapsed, voiceMemberProfileRequestRef, openVoiceMemberProfile, handleVoiceProfileMemberUpdated, loadingChannelsRef, previousVoiceChannelIdRef,
    loadVoiceChannelMembers, handleLogout, handleMuteToggle, handleDeafenToggle, handleDisconnect, handleScreenShareToggle,
    handleViewScreenShare, clearStreamHoverTimer, showStreamHoverPreview, scheduleStreamHoverPreview, hideStreamHoverPreview, keepStreamHoverPreview,
    isSelectedChannel, handleChannelClick, getChannelParticipants, handleParticipantContextMenu, handleContextMenuClose,
    getParticipantVolume, setParticipantVolume, handleVoiceParticipantUpdated, handleVoiceParticipantRemoved, openCreateChannelModal,
    handleChannelCreated, handleServerHeaderContextMenu, handleServerContextMenuClose, handleServerSettings, handleNotificationSettings, handleChannelSettings,
    handleChannelUpdate, handleChannelDelete, handleCopyServerId, normalizedChannelSearch, textChannels, voiceChannels,
    isSearching, textGroups, voiceGroups, serverId, handleDropOnCategory,
    handleDeleteCategory, handleCreateCategory, groupListProps
  } = model
  return (
    <>
      <div className="app-sidebar flex h-full flex-col border-r">
        {/* Server Header */}
        <div className="channel-sidebar-header flex h-12 shrink-0 items-center gap-1 border-b border-border/70 px-3 shadow-sm">
          <button
            type="button"
            onClick={handleServerHeaderContextMenu}
            className="group flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left transition hover:bg-secondary/60"
          >
            <span className="truncate text-[15px] font-semibold text-foreground">
              {currentServer.name}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
          </button>

          {canShowInviteButton && (
            <Tooltip content="Пригласить на сервер" side="bottom">
              <button
                type="button"
                aria-label="Пригласить на сервер"
                onClick={() => setIsInviteModalOpen(true)}
                className="channel-header-invite flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary/80 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <UserPlus className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>

        <div className="mobile-channel-tools">
          <label className="mobile-channel-search">
            <Search aria-hidden="true" />
            <span className="sr-only">Поиск каналов</span>
            <input
              type="search"
              value={channelSearch}
              onChange={(event) => setChannelSearch(event.target.value)}
              placeholder="Поиск"
              aria-label="Поиск каналов"
            />
          </label>
          {canShowInviteButton && (
            <button
              type="button"
              onClick={() => setIsInviteModalOpen(true)}
              aria-label="Пригласить на сервер"
            >
              <UserPlus aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Channels List */}
        <div className="channel-sidebar-scroll flex-1 overflow-y-auto scrollbar-thin">
          {/* Text Channels */}
          <div className="pt-4">
            <div className="mb-1 px-3">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase">
                <span>Текстовые каналы</span>
                <div className="flex items-center gap-0.5">
                  {canManageChannels && (
                    <Tooltip content="Создать категорию">
                      <button
                        type="button"
                        aria-label="Создать категорию"
                        onClick={handleCreateCategory}
                        className="rounded p-0.5 text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
                      >
                        <FolderPlus className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content="Создать канал">
                    <button
                      type="button"
                      aria-label="Создать канал"
                      onClick={() => openCreateChannelModal('text')}
                      className="rounded p-0.5 text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
            <div className="space-y-0.5 px-3">
              <ChannelGroupList
                {...groupListProps}
                groups={textGroups}
                kind="text"
                onCreateChannel={() => openCreateChannelModal('text')}
                onDropChannel={(categoryId, index) =>
                  handleDropOnCategory(textGroups, categoryId, index)
                }
                renderChannel={(channel) => {
                const mentionCount = mentionPending.filter(
                  (item: { textChannelId: number }) => item.textChannelId === channel.id
                ).length
                const hasUnread =
                  mentionCount === 0 &&
                  channelUnreadPending.some((item: { textChannelId: number }) => item.textChannelId === channel.id)
                const hoverKey = `text:${channel.id}`
                const showSettings =
                  hoveredChannel === hoverKey &&
                  currentServer &&
                  canManageChannels
                const ChannelIcon = channel.kind === 'forum' ? MessageSquare : Hash

                return (
                <div
                  key={channel.id}
                  className="relative group"
                  onMouseEnter={() => setHoveredChannel(hoverKey)}
                  onMouseLeave={() => setHoveredChannel(null)}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "interactive-row h-9 w-full justify-start gap-2 px-2.5 text-muted-foreground hover:text-foreground",
                      isSelectedChannel(channel) && "bg-accent text-foreground",
                      hasUnread && !isSelectedChannel(channel) && "text-foreground",
                      mentionCount > 0 && !isSelectedChannel(channel) && "text-[#f23f43]"
                    )}
                    onClick={() => handleChannelClick(channel)}
                  >
                    <ChannelIcon className={cn(
                      "w-4 h-4 flex-none",
                      isSelectedChannel(channel) ? "text-foreground" : "text-muted-foreground",
                      hasUnread && !isSelectedChannel(channel) && "text-foreground",
                      mentionCount > 0 && !isSelectedChannel(channel) && "text-[#f23f43]"
                    )} />
                    <span className={cn(
                      "min-w-0 flex-1 truncate text-left",
                      isSelectedChannel(channel) ? "text-foreground font-medium" : "",
                      hasUnread && !isSelectedChannel(channel) && "font-semibold text-foreground",
                      mentionCount > 0 && !isSelectedChannel(channel) && "font-semibold text-[#f23f43]"
                    )}>{channel.name}</span>
                    {mentionCount > 0 && !showSettings && (
                      <span className="ml-auto flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold leading-none text-white">
                        {formatMentionBadge(mentionCount)}
                      </span>
                    )}
                    {hasUnread && !showSettings && (
                      <span className="ml-auto h-2 w-2 flex-none rounded-full bg-foreground" />
                    )}
                  </Button>
                  {showSettings && (
                    <Tooltip
                      content="Настройки канала"
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-accent/50"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleChannelSettings(channel);
                        }}
                        aria-label="Настройки канала"
                      >
                        <Settings className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              )}}
              />
              {textChannels.length === 0 && textGroups.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  Нет текстовых каналов
                </div>
              )}
            </div>
          </div>

          {/* Voice Channels */}
          <div className="pt-4">
            <div className="mb-1 px-3">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase">
                <span>Голосовые каналы</span>
                <Tooltip content="Создать канал">
                  <button
                    type="button"
                    aria-label="Создать канал"
                    onClick={() => openCreateChannelModal('voice')}
                    className="rounded p-0.5 text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="space-y-0.5 px-3">
              <ChannelGroupList
                {...groupListProps}
                groups={voiceGroups}
                kind="voice"
                onCreateChannel={() => openCreateChannelModal('voice')}
                onDropChannel={(categoryId, index) =>
                  handleDropOnCategory(voiceGroups, categoryId, index)
                }
                renderChannel={(channel) => {
                const channelParticipants = getChannelParticipants(channel.id);
                const userLimit = channel.max_users ?? 0
                const hasUserLimit = userLimit > 0
                const hoverKey = `voice:${channel.id}`
                const isHovered = hoveredChannel === hoverKey
                const showVoiceSettings = isHovered && canManageChannels
                const currentCount = channelParticipants.length

                return (
                  <div key={channel.id}>
                    <div
                      className="relative group"
                      onMouseEnter={() => setHoveredChannel(hoverKey)}
                      onMouseLeave={() => setHoveredChannel(null)}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "interactive-row h-9 w-full justify-start gap-2 px-2.5 pr-10 text-muted-foreground",
                          currentVoiceChannelId === channel.id && "bg-green-500/10 text-green-500 ring-1 ring-inset ring-[#23a55a]/20"
                        )}
                        onClick={() => handleChannelClick(channel)}
                        disabled={isConnecting && currentVoiceChannelId !== channel.id}
                      >
                        <Volume2 className={cn(
                          "w-4 h-4 shrink-0",
                          currentVoiceChannelId === channel.id && "text-green-400"
                        )} />
                        <span className={cn(
                          "min-w-0 flex-1 truncate text-left",
                          currentVoiceChannelId === channel.id && "text-green-400"
                        )}>
                          {channel.name}
                        </span>
                        {currentVoiceChannelId === channel.id && !hasUserLimit && !showVoiceSettings && (
                          <div className="voice-status-dot shrink-0" />
                        )}
                      </Button>

                      {/* Лимит: двухцветная капсула с косым разрезом */}
                      {hasUserLimit && !showVoiceSettings && (
                        <span
                          aria-label={`Участников ${currentCount} из ${userLimit}`}
                          className="pointer-events-none absolute right-2 top-1/2 flex h-4 -translate-y-1/2 items-stretch overflow-hidden rounded-[8px] text-[12px] font-medium leading-none text-muted-foreground"
                        >
                          {/* Тёмная левая половина — косой срез справа */}
                          <span
                            className="relative z-[1] flex items-center bg-canvas-deep pl-[6px] pr-[10px] tabular-nums tracking-tight"
                            style={{
                              clipPath: 'polygon(0 0, 100% 0, calc(100% - 5px) 100%, 0 100%)',
                            }}
                          >
                            {String(currentCount).padStart(2, '0')}
                          </span>
                          {/* Светлая правая половина */}
                          <span className="-ml-[5px] flex items-center bg-surface pl-[9px] pr-[6px] tabular-nums tracking-tight">
                            {String(userLimit).padStart(2, '0')}
                          </span>
                        </span>
                      )}

                      {showVoiceSettings && (
                        <Tooltip
                          content="Настройки канала"
                          className="absolute right-2 top-1/2 -translate-y-1/2"
                        >
                          <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-[#35373c] hover:text-white"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleChannelSettings(channel);
                            }}
                            aria-label="Настройки канала"
                          >
                            <Settings className="h-4 w-4" />
                          </button>
                        </Tooltip>
                      )}
                    </div>

                    <VoiceParticipantList
                      participants={channelParticipants}
                      currentUserId={user?.id}
                      speakingUsers={speakingUsers}
                      screenSharingUsers={screenSharingUsers}
                      activeProfileUserId={voiceMemberProfile?.member.user_id ?? null}
                      onOpenProfile={(participant, anchorRect) => {
                        void openVoiceMemberProfile(participant, anchorRect)
                      }}
                      onContextMenu={(event, participant) => handleParticipantContextMenu(event, participant, channel.id)}
                      onStreamHoverStart={scheduleStreamHoverPreview}
                      onStreamHoverEnd={hideStreamHoverPreview}
                    />
                  </div>
                );
              }}
              />
              {voiceChannels.length === 0 && voiceGroups.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  Нет голосовых каналов
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {streamHoverPreview && (
        <StreamHoverPreview
          userId={streamHoverPreview.userId}
          username={streamHoverPreview.username}
          anchorRect={streamHoverPreview.anchorRect}
          isSelf={streamHoverPreview.userId === user?.id}
          onMouseEnter={keepStreamHoverPreview}
          onMouseLeave={() => hideStreamHoverPreview(120)}
        />
      )}

      <InvitePeopleModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        server={currentServer}
      />

      <CreateChannelModal
        isOpen={isCreateChannelModalOpen}
        onClose={() => setIsCreateChannelModalOpen(false)}
        serverId={currentServer.id}
        initialType={createChannelInitialType}
        categories={categories}
        categoryLabel={
          createChannelInitialType === 'voice' ? 'Голосовые каналы' : 'Текстовые каналы'
        }
        onCreated={handleChannelCreated}
      />

      <VoiceParticipantContextMenu
        target={contextMenu}
        server={currentServer}
        currentUserId={user?.id}
        volume={contextMenu ? getParticipantVolume(contextMenu.participant.user_id) : 100}
        onVolumeChange={setParticipantVolume}
        onClose={handleContextMenuClose}
        onOpenProfile={(participant, anchorRect) => void openVoiceMemberProfile(participant, anchorRect)}
        onParticipantUpdated={handleVoiceParticipantUpdated}
        onParticipantRemoved={handleVoiceParticipantRemoved}
        onMemberUpdated={handleVoiceProfileMemberUpdated}
      />

      {/* Контекстное меню для заголовка сервера */}
      <ContextMenu
        open={!!serverContextMenu}
        x={serverContextMenu?.mouseX ?? 0}
        y={serverContextMenu?.mouseY ?? 0}
        onClose={handleServerContextMenuClose}
      >
        <ContextMenuItem onClick={handleServerSettings}>
          <Settings size={18} className="text-text-quiet" />
          Настройки сервера
        </ContextMenuItem>
        <ContextMenuItem onClick={handleNotificationSettings}>
          <Bell size={18} className="text-text-quiet" />
          Настройки уведомлений
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleCopyServerId}>
          <Copy size={18} className="text-text-quiet" />
          Копировать ID
        </ContextMenuItem>
      </ContextMenu>

      <ServerNotificationSettingsModal
        isOpen={isNotificationSettingsOpen}
        onClose={() => setIsNotificationSettingsOpen(false)}
        server={currentServer}
      />

      {voiceMemberProfile && currentServer && (
        <MemberProfilePopover
          member={voiceMemberProfile.member}
          serverId={currentServer.id}
          roles={voiceMemberProfile.roles}
          anchorRect={voiceMemberProfile.anchorRect}
          onClose={() => setVoiceMemberProfile(null)}
          onMemberUpdated={handleVoiceProfileMemberUpdated}
        />
      )}

      <ServerSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        server={currentServer}
        onServerUpdate={(updatedServer) => {
          updateServer(updatedServer.id, updatedServer)
        }}
      />

      {selectedChannelForSettings && (
        <ChannelSettingsModal
          isOpen={isChannelSettingsModalOpen}
          onClose={() => {
            setIsChannelSettingsModalOpen(false)
            setSelectedChannelForSettings(null)
          }}
          channel={selectedChannelForSettings}
          onChannelUpdate={handleChannelUpdate}
          onChannelDelete={handleChannelDelete}
          onPermissionsChange={() => void loadServers()}
        />
      )}

    </>
  )
}
