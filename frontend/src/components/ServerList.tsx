'use client'

import { useState, useEffect } from 'react'
import { Plus, Home, Settings, Copy, X, ChevronRight, Bell } from 'lucide-react'
import { useStore } from '../lib/store'
import { useAuthStore } from '../store/store'
import { useDmNotificationStore, selectPendingDmNotifications } from '../store/dmNotificationStore'
import {
  useMentionNotificationStore,
  formatMentionBadge,
} from '../store/mentionNotificationStore'
import { useChannelUnreadStore } from '../store/channelUnreadStore'
import { queueDirectMessage } from '../lib/dmNavigation'
import { UserAvatar } from './ui/user-avatar'
import { Tooltip } from './ui/tooltip'
import { cn } from '../lib/utils'
import { resolveMediaUrl } from '../lib/mediaUrl'
import { Button } from './ui/button'
import { Modal } from './ui/modal'
import channelService from '../services/channelService'
import { ServerSettingsModal } from './ServerSettingsModal'
import { ServerNotificationSettingsModal } from './ServerNotificationSettingsModal'
import { Server } from '../types'
import { User } from '../types'

export function ServerList() {
  const { servers, currentServer, selectServer, loadServers, updateServer } = useStore()
  const { user } = useAuthStore()
  const pendingDmNotifications = useDmNotificationStore(selectPendingDmNotifications)
  const markDmViewed = useDmNotificationStore((state) => state.markViewed)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [isNotificationSettingsOpen, setIsNotificationSettingsOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState<number | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [selectedServer, setSelectedServer] = useState<Server | null>(null)
  const [newServerName, setNewServerName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createStep, setCreateStep] = useState<'template' | 'custom'>('template')

  const serverTemplates = [
    {
      id: 'custom',
      name: 'Свой шаблон',
      description: 'Создайте свой собственный сервер и настройте его по своему вкусу',
      icon: '🛠️',
      color: '#5865f2'
    },
    {
      id: 'gaming',
      name: 'Игры',
      description: 'Играйте вместе с друзьями',
      icon: '🎮',
      color: '#57f287'
    },
    {
      id: 'friends',
      name: 'Друзья',
      description: 'Общайтесь с друзьями и семьей',
      icon: '💕',
      color: '#eb459e'
    },
    {
      id: 'study',
      name: 'Учебная группа',
      description: 'Получите помощь с домашним заданием, поделитесь заметками и многое другое',
      icon: '🍎',
      color: '#fee75c'
    },
    {
      id: 'club',
      name: 'Школьный клуб',
      description: 'Общайтесь с одноклассниками в школьном клубе',
      icon: '📚',
      color: '#4f545c'
    }
  ]

  const handleCreateServer = async () => {
    if (!newServerName.trim()) return

    setIsCreating(true)
    try {
      const newServer = await channelService.createServer({
        name: newServerName,
        description: `Сервер ${newServerName}`
      })

      await loadServers()
      await selectServer(newServer.id)

      setIsCreateModalOpen(false)
      setNewServerName('')
      setCreateStep('template')
    } catch (error) {
      console.error('Ошибка создания сервера:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleTemplateSelect = (templateId: string) => {
    if (templateId === 'custom') {
      setCreateStep('custom')
    } else {
      // Для других шаблонов можно установить предустановленные названия
      const template = serverTemplates.find(t => t.id === templateId)
      if (template) {
        setNewServerName(template.name)
        setCreateStep('custom')
      }
    }
  }

  const handleContextMenu = (e: React.MouseEvent, server: Server) => {
    e.preventDefault()
    e.stopPropagation()
    
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setContextMenuOpen(server.id)
    setSelectedServer(server)
  }

  const handleServerSettings = () => {
    if (selectedServer) {
      setIsSettingsModalOpen(true)
      setContextMenuOpen(null)
    }
  }

  const handleNotificationSettings = () => {
    if (selectedServer) {
      setIsNotificationSettingsOpen(true)
      setContextMenuOpen(null)
    }
  }

  const handleCopyServerId = () => {
    if (selectedServer) {
      navigator.clipboard.writeText(selectedServer.id.toString())
      setContextMenuOpen(null)
    }
  }

  const handleServerUpdate = (updatedServer: Server) => {
    updateServer(updatedServer.id, updatedServer)
  }

  const closeContextMenu = () => {
    setContextMenuOpen(null)
    setSelectedServer(null)
  }

  const handlePendingDmClick = async (entry: { user: User; unreadCount: number }) => {
    markDmViewed(entry.user.id)
    queueDirectMessage(entry.user)
    await selectServer(0)
  }

  const formatUnreadBadge = (count: number) => formatMentionBadge(count)
  const mentionPending = useMentionNotificationStore((state) => state.pending)
  const channelUnreadPending = useChannelUnreadStore((state) => state.pending)

  useEffect(() => {
    const handleGlobalClick = () => {
      if (contextMenuOpen) {
        closeContextMenu()
      }
    }

    if (contextMenuOpen) {
      document.addEventListener('click', handleGlobalClick)
      return () => document.removeEventListener('click', handleGlobalClick)
    }
  }, [contextMenuOpen])

  return (
    <>
      <div className="app-rail flex h-full flex-col items-center gap-3 border-r py-4">
        {/* Home Button */}
        <div className="relative flex w-full justify-center">
          {!currentServer && (
            <div className="absolute left-0 top-1/2 h-10 w-1 -translate-y-1/2 rounded-r-full bg-foreground" />
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-12 w-12 rounded-[1.5rem] transition-[border-radius,background-color,color,transform] duration-200 ease-out",
              !currentServer
                ? "rounded-[0.9rem] bg-primary text-primary-foreground"
                : "hover:rounded-[0.9rem] hover:bg-primary hover:text-primary-foreground",
              "active:scale-[0.97]"
            )}
            onClick={() => selectServer(0)}
          >
            <Home className="w-5 h-5" />
          </Button>
        </div>

        {pendingDmNotifications.length > 0 && (
          <div className="flex w-full flex-col items-center gap-3">
            {pendingDmNotifications.map((entry) => (
              <div key={entry.user.id} className="relative flex w-full justify-center">
                <Tooltip
                  content={`${entry.user.display_name || entry.user.username} — ${entry.unreadCount} новых`}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative h-12 w-12 overflow-visible rounded-[1.5rem] border border-border/60 bg-secondary p-0 transition-[border-radius,background-color,transform] duration-200 ease-out hover:rounded-[0.9rem] hover:bg-accent active:scale-[0.97]"
                    onClick={() => void handlePendingDmClick(entry)}
                    aria-label={`${entry.user.display_name || entry.user.username} — ${entry.unreadCount} новых`}
                  >
                    <UserAvatar user={entry.user} size={48} sx={{ width: 48, height: 48 }} />
                    <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
                      {formatUnreadBadge(entry.unreadCount)}
                    </span>
                  </Button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}

        <div className="server-rail-divider server-rail-divider--primary h-[2px] w-8 rounded-full bg-border" />

        {/* Server Icons */}
        <div className="flex w-full flex-1 flex-col items-center gap-3">
          {servers.map((server) => {
            const isActive = currentServer?.id === server.id
            const mentionCount = mentionPending.filter((item) => item.serverId === server.id).length
            const hasUnread =
              mentionCount === 0 &&
              channelUnreadPending.some((item) => item.serverId === server.id)

            return (
              <div key={server.id} className="group relative flex w-full justify-center">
                {isActive ? (
                  <div className="absolute left-0 top-1/2 h-10 w-1 -translate-y-1/2 rounded-r-full bg-foreground" />
                ) : hasUnread || mentionCount > 0 ? (
                  <div className="absolute left-0 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground" />
                ) : null}
                <Tooltip
                  content={
                    mentionCount > 0
                      ? `${server.name} — ${mentionCount} упоминаний`
                      : hasUnread
                        ? `${server.name} — есть новые сообщения`
                        : server.name
                  }
                  side="right"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "relative h-12 w-12 overflow-visible rounded-[1.5rem] border border-border/60 bg-secondary transition-[border-radius,background-color,color,transform] duration-200 ease-out hover:rounded-[0.9rem] hover:bg-accent",
                      isActive && "rounded-[0.9rem] bg-primary text-primary-foreground hover:bg-primary/90",
                      "active:scale-[0.97]"
                    )}
                    onClick={() => selectServer(server.id)}
                    onContextMenu={(e) => handleContextMenu(e, server)}
                    aria-label={server.name}
                  >
                  <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit]">
                    {server.icon ? (
                      <img
                        key={server.icon}
                        src={resolveMediaUrl(server.icon) || server.icon}
                        alt={server.name}
                        className="h-full w-full object-cover"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : (
                      <span className="text-lg font-semibold">
                        {server.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </span>
                  {mentionCount > 0 && (
                    <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
                      {formatUnreadBadge(mentionCount)}
                    </span>
                  )}
                </Button>
                </Tooltip>
              </div>
            )
          })}

          {/* Add Server Button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 rounded-[1.5rem] border border-dashed border-border text-muted-foreground transition-[border-radius,background-color,color,transform] duration-200 ease-out hover:rounded-[0.9rem] hover:bg-primary hover:text-primary-foreground active:scale-[0.97]"
            onClick={() => setIsCreateModalOpen(true)}
          >
            <Plus className="w-5 h-5" />
          </Button>
        </div>

        <div className="server-rail-divider h-[2px] w-8 rounded-full bg-border" />
      </div>

      {/* Create Server Modal */}
      <Modal
        open={isCreateModalOpen}
        onClose={() => {
          if (isCreating) return
          setIsCreateModalOpen(false)
          setCreateStep('template')
          setNewServerName('')
        }}
        title="Создайте свой сервер"
        contentClassName="max-w-lg min-h-[500px] bg-background text-foreground"
      >
        {createStep === 'template' ? (
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="mb-2 text-2xl font-bold text-foreground">Создайте свой сервер</h2>
                <p className="text-sm text-text-quiet">
                  Ваш сервер — это место, где вы можете тусоваться со своими друзьями. Создайте сервер и начните общаться.
                </p>
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => {
                  setIsCreateModalOpen(false)
                  setCreateStep('template')
                  setNewServerName('')
                }}
                className="rounded p-1 text-text-quiet hover:text-foreground"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-3">
              {serverTemplates.map((template) => (
                <div
                  key={template.id}
                  onClick={() => handleTemplateSelect(template.id)}
                  className="group flex cursor-pointer items-center rounded-lg bg-surface p-4 transition-colors hover:bg-gray-700"
                >
                  <div className="mr-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-700">
                    <span className="text-2xl">{template.icon}</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-foreground">{template.name}</h3>
                    <p className="text-sm text-text-quiet">{template.description}</p>
                  </div>
                  <ChevronRight size={20} className="text-text-quiet transition-colors group-hover:text-foreground" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="mb-2 text-2xl font-bold text-foreground">Создать сервер</h2>
                <p className="text-sm text-text-quiet">
                  Дайте серверу индивидуальность с именем и значком. Вы всегда можете изменить это позже.
                </p>
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => {
                  setIsCreateModalOpen(false)
                  setCreateStep('template')
                  setNewServerName('')
                }}
                className="rounded p-1 text-text-quiet hover:text-foreground"
              >
                <X size={24} />
              </button>
            </div>

            <div className="mb-6">
              <label htmlFor="new-server-name" className="mb-2 block text-xs font-bold uppercase text-text-quiet">
                Название сервера
              </label>
              <input
                id="new-server-name"
                value={newServerName}
                onChange={(e) => setNewServerName(e.target.value)}
                required
                className="h-11 w-full rounded-control border border-border bg-surface-deep px-3 text-foreground outline-none focus:border-primary"
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setCreateStep('template')}
                disabled={isCreating}
              >
                Назад
              </Button>
              <Button
                onClick={() => handleCreateServer()}
                disabled={!newServerName.trim() || isCreating}
                className="bg-primary text-white hover:bg-brand-hover"
              >
                {isCreating ? 'Создание...' : 'Создать'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Context Menu */}
      {contextMenuOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={closeContextMenu}
          />
          <div 
            className="fixed z-50 bg-background border border-border rounded-md shadow-lg min-w-[200px]"
            style={{ 
              left: contextMenuPosition.x, 
              top: contextMenuPosition.y 
            }}
          >
            <div className="py-1">
              <button
                onClick={handleServerSettings}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Настройки сервера
              </button>
              <button
                onClick={handleNotificationSettings}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition flex items-center gap-2"
              >
                <Bell className="w-4 h-4" />
                Настройки уведомлений
              </button>
              <div className="border-t border-border my-1" />
              <button
                onClick={handleCopyServerId}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                Копировать ID
              </button>
            </div>
          </div>
        </>
      )}

      {/* Server Settings Modal */}
      {selectedServer && (
        <ServerSettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          server={selectedServer}
          onServerUpdate={handleServerUpdate}
        />
      )}

      {selectedServer && (
        <ServerNotificationSettingsModal
          isOpen={isNotificationSettingsOpen}
          onClose={() => setIsNotificationSettingsOpen(false)}
          server={selectedServer}
        />
      )}
    </>
  )
}
