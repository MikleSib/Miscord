'use client'

import { useState } from 'react'
import { Plus, Home, UserPlus } from 'lucide-react'
import { useStore } from '../lib/store'
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

export function ServerList() {
  const { servers, currentServer, selectServer, addServer } = useStore()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
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
                  "w-12 h-12 rounded-2xl bg-secondary hover:bg-accent transition-all duration-200",
                  currentServer?.id === server.id && "bg-primary text-primary-foreground hover:bg-primary/90",
                  "hover:rounded-xl"
                )}
                onClick={() => selectServer(server.id)}
              >
                <span className="font-semibold text-lg">
                  {server.name.slice(0, 2).toUpperCase()}
                </span>
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
    </>
  )
}