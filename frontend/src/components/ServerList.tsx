'use client'

import { useState } from 'react'
import { Plus, Home, UserPlus, Settings, Copy, UserCheck } from 'lucide-react'
import { useStore } from '../lib/store'
import { useAuthStore } from '../store/store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  TextField,
  Box,
  IconButton,
  Tooltip
} from '@mui/material'
import channelService from '../services/channelService'
import { ServerSettingsModal } from './ServerSettingsModal'
import { Server } from '../types'

export function ServerList() {
  const { servers, currentServer, selectServer, addServer, updateServer } = useStore()
  const { user } = useAuthStore()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState<number | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [selectedServer, setSelectedServer] = useState<Server | null>(null)
  const [newServerName, setNewServerName] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isInviting, setIsInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')

  const handleCreateServer = async () => {
    if (!newServerName.trim()) return

    setIsCreating(true)
    try {
      const newServer = await channelService.createServer({
        name: newServerName,
        description: `Сервер ${newServerName}`
      })

      addServer({
        id: newServer.id,
        name: newServer.name,
        description: newServer.description,
        channels: [
          { id: 1, name: 'general', type: 'text', serverId: newServer.id },
          { id: 2, name: 'General', type: 'voice', serverId: newServer.id }
        ]
      })

      setIsCreateModalOpen(false)
      setNewServerName('')
    } catch (error) {
      console.error('Ошибка создания сервера:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleInviteUser = async () => {
    if (!inviteUsername.trim() || !currentServer) return

    setIsInviting(true)
    setInviteError('')
    
    try {
      await channelService.inviteUserToServer(currentServer.id, inviteUsername)
      setIsInviteModalOpen(false)
      setInviteUsername('')
      // Можно добавить уведомление об успешном приглашении
    } catch (error: any) {
      console.error('Ошибка приглашения пользователя:', error)
      if (error.response?.data?.detail) {
        setInviteError(error.response.data.detail)
      } else {
        setInviteError('Не удалось пригласить пользователя')
      }
    } finally {
      setIsInviting(false)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, server: Server) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Проверяем, является ли текущий пользователь владельцем сервера
    if (user && server.owner_id === user.id) {
      setContextMenuPosition({ x: e.clientX, y: e.clientY })
      setContextMenuOpen(server.id)
      setSelectedServer(server)
    }
  }

  const handleServerSettings = () => {
    if (selectedServer) {
      setIsSettingsModalOpen(true)
      setContextMenuOpen(null)
    }
  }

  const handleInviteToServer = () => {
    if (selectedServer) {
      selectServer(selectedServer.id)
      setIsInviteModalOpen(true)
      setContextMenuOpen(null)
    }
  }

  const handleCopyServerId = () => {
    if (selectedServer) {
      navigator.clipboard.writeText(selectedServer.id.toString())
      setContextMenuOpen(null)
      // Можно добавить уведомление о копировании
    }
  }

  const handleServerUpdate = (updatedServer: Server) => {
    updateServer(updatedServer.id, updatedServer)
  }

  const closeContextMenu = () => {
    setContextMenuOpen(null)
    setSelectedServer(null)
  }

  return (
    <>
      <div className="w-[72px] bg-card flex flex-col items-center py-3 gap-2 border-r border-border">
        {/* Home Button */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "w-12 h-12 rounded-full transition-all",
            !currentServer && "bg-primary text-primary-foreground"
          )}
          onClick={() => selectServer(0)}
        >
          <Home className="w-5 h-5" />
        </Button>

        <div className="w-8 h-[2px] bg-border rounded-full" />

        {/* Server Icons */}
        <div className="flex flex-col gap-2">
          {servers.map((server) => (
            <div key={server.id} className="relative group">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "w-12 h-12 rounded-2xl bg-secondary hover:bg-accent transition-all duration-200 overflow-hidden",
                  currentServer?.id === server.id && "bg-primary text-primary-foreground hover:bg-primary/90",
                  "hover:rounded-xl"
                )}
                onClick={() => selectServer(server.id)}
                onContextMenu={(e) => handleContextMenu(e, server)}
              >
                {server.icon ? (
                  <img 
                    src={server.icon} 
                    alt={server.name} 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="font-semibold text-lg">
                    {server.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </Button>
              
              {/* Индикатор активного сервера */}
              {currentServer?.id === server.id && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full -ml-2" />
              )}
              
              {/* Кнопка приглашения при наведении на активный сервер */}
              {currentServer?.id === server.id && (
                <div className="absolute -right-1 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Tooltip title="Пригласить пользователя">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        setIsInviteModalOpen(true)
                      }}
                      sx={{
                        backgroundColor: 'rgba(67, 181, 129, 0.1)',
                        color: '#43b581',
                        width: 24,
                        height: 24,
                        '&:hover': {
                          backgroundColor: 'rgba(67, 181, 129, 0.2)',
                        }
                      }}
                    >
                      <UserPlus size={14} />
                    </IconButton>
                  </Tooltip>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="w-8 h-[2px] bg-border rounded-full" />

        {/* Add Server Button */}
        <Button
          variant="ghost"
          size="icon"
          className="w-12 h-12 rounded-full transition-all hover:rounded-2xl hover:bg-primary hover:text-primary-foreground"
          onClick={() => setIsCreateModalOpen(true)}
        >
          <Plus className="w-5 h-5" />
        </Button>
      </div>

      {/* Create Server Modal */}
      <Dialog open={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)}>
        <DialogContent>
          <DialogTitle>Создать сервер</DialogTitle>
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Название сервера"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              fullWidth
              required
            />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
              <Button
                variant="outline"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isCreating}
              >
                Отмена
              </Button>
              <Button
                onClick={handleCreateServer}
                disabled={!newServerName.trim() || isCreating}
              >
                {isCreating ? 'Создание...' : 'Создать'}
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Invite User Modal */}
      <Dialog open={isInviteModalOpen} onClose={() => setIsInviteModalOpen(false)}>
        <DialogContent>
          <DialogTitle>Пригласить пользователя</DialogTitle>
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Имя пользователя"
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              fullWidth
              required
              error={!!inviteError}
              helperText={inviteError}
            />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
              <Button
                variant="outline"
                onClick={() => {
                  setIsInviteModalOpen(false)
                  setInviteError('')
                  setInviteUsername('')
                }}
                disabled={isInviting}
              >
                Отмена
              </Button>
              <Button
                onClick={handleInviteUser}
                disabled={!inviteUsername.trim() || isInviting}
              >
                {isInviting ? 'Приглашение...' : 'Пригласить'}
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

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
                onClick={handleInviteToServer}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Пригласить людей
              </button>
              <div className="border-t border-border my-1" />
              <button
                onClick={handleServerSettings}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Настройки сервера
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
    </>
  )
}