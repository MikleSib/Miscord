'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { Ban, CalendarDays, ChevronLeft, ClipboardCheck, CopyPlus, Flag, Info, Link2, LogOut, ScrollText, Shield, ShieldCheck, Trash2, Users, X } from 'lucide-react'

import { Server } from '../types'
import channelService from '../services/channelService'
import { useStore } from '../lib/store'
import { useVoiceStore } from '../store/slices/voiceSlice'
import { cn } from '../lib/utils'
import { Permissions } from '../lib/permissions'
import { useServerPermissions } from '../lib/serverPermissions'
import { ConfirmDialog } from './server-settings/ConfirmDialog'
import { ServerOverviewTab } from './server-settings/ServerOverviewTab'
import { ServerMembersTab } from './server-settings/ServerMembersTab'
import { ServerRolesTab } from './server-settings/ServerRolesTab'
import { ServerInvitesTab } from './server-settings/ServerInvitesTab'
import { ServerBansTab } from './server-settings/ServerBansTab'
import { ServerAuditLogTab } from './server-settings/ServerAuditLogTab'
import { ServerBotsTab } from './server-settings/ServerBotsTab'
import { ServerTemplatesTab } from './server-settings/ServerTemplatesTab'
import { ServerOnboardingTab } from './server-settings/ServerOnboardingTab'
import { ServerEventsTab } from './server-settings/ServerEventsTab'
import { ServerAutoModTab } from './server-settings/ServerAutoModTab'
import { ServerReportsTab } from './server-settings/ServerReportsTab'
import { useMobileSettingsDetail } from '../hooks/useMobileSettingsDetail'
import { useModalFocusTrap } from '../hooks/useModalFocusTrap'
import { useCapabilities } from '../features/capabilities/capabilities'

interface ServerSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  server: Server
  onServerUpdate: (updatedServer: Server) => void
}

type TabId = 'overview' | 'members' | 'roles' | 'bots' | 'templates' | 'onboarding' | 'events' | 'automod' | 'reports' | 'invites' | 'bans' | 'audit'

interface TabItem {
  id: TabId
  label: string
  icon: LucideIcon
  group?: 'community' | 'users' | 'moderation'
  /** Право, без которого вкладка не показывается. undefined — доступна всем участникам. */
  permission?: number
}

const TABS: TabItem[] = [
  { id: 'onboarding', label: 'Onboarding', icon: ClipboardCheck, group: 'community', permission: Permissions.MANAGE_SERVER },
  { id: 'events', label: 'События', icon: CalendarDays, group: 'community' },
  { id: 'templates', label: 'Шаблоны', icon: CopyPlus, group: 'users', permission: Permissions.ADMINISTRATOR },
  { id: 'overview', label: 'Профиль сервера', icon: Info },
  { id: 'members', label: 'Участники', icon: Users, group: 'users' },
  { id: 'roles', label: 'Роли', icon: Shield, group: 'users', permission: Permissions.MANAGE_ROLES },
  { id: 'bots', label: 'Боты', icon: Users, group: 'users', permission: Permissions.MANAGE_SERVER },
  { id: 'invites', label: 'Приглашения', icon: Link2, group: 'users', permission: Permissions.CREATE_INVITE },
  { id: 'bans', label: 'Блокировки', icon: Ban, group: 'moderation', permission: Permissions.BAN_MEMBERS },
  { id: 'automod', label: 'AutoMod', icon: ShieldCheck, group: 'moderation', permission: Permissions.MANAGE_SERVER },
  { id: 'reports', label: 'Жалобы', icon: Flag, group: 'moderation', permission: Permissions.MODERATE_MEMBERS },
  { id: 'audit', label: 'Журнал аудита', icon: ScrollText, group: 'moderation', permission: Permissions.VIEW_AUDIT_LOG },
]

const GROUP_LABELS: Record<string, string> = {
  community: 'Сообщество',
  users: 'Пользователи',
  moderation: 'Модерация',
}

/** Выше сайдбара (z-50), профиля (z-50/60) и lightbox (z-100). */
const MODAL_Z_INDEX = 100

export function ServerSettingsModal({ isOpen, onClose, server, onServerUpdate }: ServerSettingsModalProps) {
  const { removeServer, selectServer } = useStore()
  const { can, isOwner } = useServerPermissions(isOpen ? server.id : null)
  const capabilities = useCapabilities()

  const [mounted, setMounted] = useState(false)

  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const [dangerError, setDangerError] = useState('')
  const mobileSettings = useMobileSettingsDetail(isOpen)
  const closeModal = () => {
    mobileSettings.closeDetail()
    onClose()
  }
  const dialogRef = useModalFocusTrap<HTMLDivElement>(isOpen, () => {
    if (showDeleteConfirm || showLeaveConfirm) {
      setShowDeleteConfirm(false)
      setShowLeaveConfirm(false)
      return
    }
    closeModal()
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  const visibleTabs = useMemo(
    () => TABS.filter((tab) => {
      if (tab.id === 'templates' && !capabilities.serverTemplates) return false
      if (tab.id === 'bots' && !capabilities.botPlatform) return false
      return tab.permission === undefined || can(tab.permission)
    }),
    [can, capabilities.botPlatform, capabilities.serverTemplates]
  )

  useEffect(() => {
    if (!isOpen) return
    setActiveTab('overview')
    setDangerError('')
    setShowDeleteConfirm(false)
    setShowLeaveConfirm(false)
  }, [isOpen, server.id])

  // Права могли измениться на ходу — не оставляем открытой недоступную вкладку
  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab('overview')
    }
  }, [visibleTabs, activeTab])

  const handleLeaveServer = async () => {
    setIsLeaving(true)
    setDangerError('')
    try {
      const voiceState = useVoiceStore.getState()
      const inVoiceOnThisServer =
        voiceState.currentVoiceChannelId &&
        server.channels.some(
          (channel) => channel.type === 'voice' && channel.id === voiceState.currentVoiceChannelId
        )

      if (inVoiceOnThisServer) {
        useVoiceStore.getState().disconnectFromVoiceChannel()
      }

      await channelService.leaveServer(server.id)
      removeServer(server.id)
      await selectServer(0)
      onClose()
    } catch (error: any) {
      console.error('Ошибка выхода из сервера:', error)
      setDangerError(error.response?.data?.detail || 'Не удалось покинуть сервер')
    } finally {
      setIsLeaving(false)
      setShowLeaveConfirm(false)
    }
  }

  const handleDeleteServer = async () => {
    setIsDeleting(true)
    setDangerError('')
    try {
      await channelService.deleteServer(server.id)
      // Состояние обновит WebSocket-событие server_deleted
      onClose()
    } catch (error: any) {
      console.error('Ошибка удаления сервера:', error)
      setDangerError(error.response?.data?.detail || 'Не удалось удалить сервер')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  if (!isOpen || !mounted) return null

  const activeTabItem = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]

  let renderedGroup: string | undefined

  return createPortal(
    <div
      className="miscord-responsive-modal miscord-settings-dialog fixed inset-0 flex items-center justify-center p-4"
      data-mobile-detail={mobileSettings.mobileDetailAttribute}
      style={{ zIndex: MODAL_Z_INDEX }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} />

      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="server-settings-title" className="miscord-responsive-modal-card relative flex w-full max-w-5xl h-[680px] max-h-[92vh] overflow-hidden rounded-xl border border-border bg-background shadow-2xl outline-none">
        {/* Sidebar */}
        <div className="miscord-settings-sidebar flex w-60 flex-none flex-col border-r border-border bg-secondary">
          <div className="border-b border-border px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Настройки сервера
            </p>
            <h2 className="mt-1 truncate text-base font-semibold" title={server.name}>
              {server.name}
            </h2>
          </div>

          <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-2">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              const showGroupLabel = tab.group && tab.group !== renderedGroup
              if (tab.group) renderedGroup = tab.group

              return (
                <React.Fragment key={tab.id}>
                  {showGroupLabel && (
                    <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {GROUP_LABELS[tab.group as string]}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.id)
                      mobileSettings.openDetail()
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      activeTab === tab.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-none" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                </React.Fragment>
              )
            })}
          </nav>

          <div className="border-t border-border p-2">
            {isOwner ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-red-500 transition-colors hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4 flex-none" />
                Удалить сервер
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(true)}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-red-500 transition-colors hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4 flex-none" />
                Покинуть сервер
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="miscord-settings-detail server-settings-detail flex min-w-0 flex-1 flex-col">
          <div className="miscord-settings-header flex h-14 flex-none items-center justify-between border-b border-border px-6">
            <div className="flex min-w-0 items-center gap-2">
              {mobileSettings.detailOpen && (
                <button type="button" onClick={mobileSettings.closeDetail} className="miscord-settings-back" aria-label="К разделам настроек">
                  <ChevronLeft aria-hidden="true" />
                </button>
              )}
              <h1 id="server-settings-title" className="truncate text-lg font-semibold">{activeTabItem.label}</h1>
            </div>
            <button
              type="button"
              onClick={closeModal}
              aria-label="Закрыть настройки"
              className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1">
            {dangerError && (
              <div className="mx-6 mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {dangerError}
              </div>
            )}

            {activeTab === 'overview' && (
              <ServerOverviewTab server={server} onServerUpdate={onServerUpdate} />
            )}
            {activeTab === 'members' && <ServerMembersTab server={server} />}
            {activeTab === 'roles' && <ServerRolesTab server={server} />}
            {activeTab === 'bots' && <ServerBotsTab server={server} />}
            {activeTab === 'templates' && <ServerTemplatesTab server={server} />}
            {activeTab === 'onboarding' && <ServerOnboardingTab server={server} />}
            {activeTab === 'events' && <ServerEventsTab server={server} />}
              {activeTab === 'automod' && <ServerAutoModTab server={server} />}
              {activeTab === 'reports' && <ServerReportsTab server={server} />}
            {activeTab === 'invites' && <ServerInvitesTab server={server} />}
            {activeTab === 'bans' && <ServerBansTab server={server} />}
            {activeTab === 'audit' && <ServerAuditLogTab server={server} />}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showLeaveConfirm}
        title="Покинуть сервер"
        description={
          <>
            Вы уверены, что хотите покинуть сервер <strong>«{server.name}»</strong>? Чтобы вернуться,
            вас снова нужно будет пригласить.
          </>
        }
        confirmLabel="Покинуть сервер"
        pendingLabel="Выход..."
        isPending={isLeaving}
        onConfirm={handleLeaveServer}
        onCancel={() => setShowLeaveConfirm(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Удалить сервер"
        description={
          <>
            Вы уверены, что хотите удалить сервер <strong>«{server.name}»</strong>? Это действие нельзя
            отменить: все каналы и сообщения будут удалены навсегда.
          </>
        }
        confirmLabel="Удалить сервер"
        pendingLabel="Удаление..."
        isPending={isDeleting}
        onConfirm={handleDeleteServer}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>,
    document.body
  )
}
