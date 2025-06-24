'use client'

import { useState, useEffect } from 'react'
import { Plus, Home, UserPlus, Settings, Copy, UserCheck, X, ChevronRight, Users, Gamepad2, Heart, Apple, BookOpen } from 'lucide-react'
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

  const handleInviteUser = async () => {
    if (!inviteUsername.trim() || !currentServer) return

    setIsInviting(true)
    setInviteError('')
    
    try {
      await channelService.inviteUserToServer(currentServer.id, inviteUsername)
      setIsInviteModalOpen(false)
      setInviteUsername('')
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
    
    console.log('Context menu triggered:', {
      user: user,
      server: server,
      server_owner_id: server.owner_id,
      user_id: user?.id,
      isOwner: user && server.owner_id === user.id
    })
    
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
    }
  }

  const handleServerUpdate = (updatedServer: Server) => {
    updateServer(updatedServer.id, updatedServer)
  }

  const closeContextMenu = () => {
    setContextMenuOpen(null)
    setSelectedServer(null)
  }

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
      <div className="w-[72px] bg-[#2c2d32] flex flex-col items-center py-3 gap-2 border-r border-[#393a3f] h-screen">
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
        <div className="flex flex-col gap-2 flex-1">
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
                    className="w-full h-full object-cover rounded-2xl" 
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

        <div className="w-8 h-[2px] bg-border rounded-full" />
      </div>

      {/* Create Server Modal */}
      <Dialog 
        open={isCreateModalOpen} 
        onClose={() => {
          setIsCreateModalOpen(false)
          setCreateStep('template')
          setNewServerName('')
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#313338',
            color: 'white',
            borderRadius: '8px',
            minHeight: '500px'
          }
        }}
      >
        <DialogContent sx={{ padding: 0 }}>
          {createStep === 'template' ? (
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-2">Создайте свой сервер</h2>
                  <p className="text-[#b5bac1] text-sm">Ваш сервер — это место, где вы можете тусоваться со своими друзьями. Создайте сервер и начните общаться.</p>
                </div>
                <IconButton
                  onClick={() => {
                    setIsCreateModalOpen(false)
                    setCreateStep('template')
                    setNewServerName('')
                  }}
                  sx={{ color: '#b5bac1' }}
                >
                  <X size={24} />
                </IconButton>
              </div>

              <div className="space-y-3">
                {serverTemplates.map((template) => (
                  <div
                    key={template.id}
                    onClick={() => handleTemplateSelect(template.id)}
                    className="flex items-center p-4 bg-[#2b2d31] hover:bg-[#35373c] rounded-lg cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center justify-center w-12 h-12 bg-[#404249] rounded-lg mr-4">
                      <span className="text-2xl">{template.icon}</span>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-white text-base">{template.name}</h3>
                      <p className="text-[#b5bac1] text-sm">{template.description}</p>
                    </div>
                    <ChevronRight size={20} className="text-[#b5bac1] group-hover:text-white transition-colors" />
                  </div>
                ))}
              </div>

            
            </div>
          ) : (
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-2">Создать сервер</h2>
                  <p className="text-[#b5bac1] text-sm">Дайте серверу индивидуальность с именем и значком. Вы всегда можете изменить это позже.</p>
                </div>
                <IconButton
                  onClick={() => {
                    setIsCreateModalOpen(false)
                    setCreateStep('template')
                    setNewServerName('')
                  }}
                  sx={{ color: '#b5bac1' }}
                >
                  <X size={24} />
                </IconButton>
              </div>

              <div className="mb-6">
                <TextField
                  label="Название сервера"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  fullWidth
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: '#1e1f22',
                      color: 'white',
                      '& fieldset': {
                        borderColor: '#383a40',
                      },
                      '&:hover fieldset': {
                        borderColor: '#5865f2',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#5865f2',
                      },
                    },
                    '& .MuiInputLabel-root': {
                      color: '#b5bac1',
                      '&.Mui-focused': {
                        color: '#5865f2',
                      },
                    },
                  }}
                />
              </div>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setCreateStep('template')}
                  disabled={isCreating}
                  className="bg-transparent border-[#4e5058] text-white hover:bg-[#4e5058] hover:border-[#4e5058]"
                >
                  Назад
                </Button>
                <Button
                  onClick={() => handleCreateServer()}
                  disabled={!newServerName.trim() || isCreating}
                  className="bg-[#5865f2] hover:bg-[#4752c4] text-white"
                >
                  {isCreating ? 'Создание...' : 'Создать'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Invite User Modal */}
      <Dialog 
        open={isInviteModalOpen} 
        onClose={() => {
          setIsInviteModalOpen(false)
          setInviteError('')
          setInviteUsername('')
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#313338',
            color: 'white',
            borderRadius: '8px',
            minWidth: '440px'
          }
        }}
      >
        <DialogContent sx={{ padding: 0 }}>
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">Пригласить пользователя</h2>
                <p className="text-[#b5bac1] text-sm">
                  {currentServer ? `на сервер ${currentServer.name}` : 'на сервер'}
                </p>
              </div>
              <IconButton
                onClick={() => {
                  setIsInviteModalOpen(false)
                  setInviteError('')
                  setInviteUsername('')
                }}
                sx={{ color: '#b5bac1' }}
              >
                <X size={24} />
              </IconButton>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#b5bac1] mb-2">
                  Имя пользователя *
                </label>
                <TextField
                  value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                  fullWidth
                  placeholder="Введите имя пользователя..."
                  error={!!inviteError}
                  helperText={inviteError}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: '#1e1f22',
                      color: 'white',
                      fontSize: '16px',
                      '& fieldset': {
                        borderColor: '#383a40',
                      },
                      '&:hover fieldset': {
                        borderColor: '#5865f2',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#5865f2',
                      },
                      '&.Mui-error fieldset': {
                        borderColor: '#ed4245',
                      },
                    },
                    '& .MuiInputBase-input': {
                      padding: '12px 16px',
                    },
                    '& .MuiFormHelperText-root': {
                      color: '#ed4245',
                      marginLeft: 0,
                      marginTop: '8px',
                    },
                  }}
                />
              </div>

              {!inviteError && (
                <div className="bg-[#2b2d31] p-4 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-[#5865f2] rounded-full flex items-center justify-center text-white font-semibold">
                      ?
                    </div>
                    <div>
                      <h4 className="text-white font-medium text-sm mb-1">Как пригласить пользователя</h4>
                      <p className="text-[#b5bac1] text-xs leading-relaxed">
                        Введите точное имя пользователя. После приглашения пользователь получит уведомление 
                        и сможет присоединиться к серверу.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end mt-6 pt-6 border-t border-[#393a3f]">
              <Button
                variant="outline"
                onClick={() => {
                  setIsInviteModalOpen(false)
                  setInviteError('')
                  setInviteUsername('')
                }}
                disabled={isInviting}
                className="bg-transparent border-[#4e5058] text-white hover:bg-[#4e5058] hover:border-[#4e5058] px-6"
              >
                Отмена
              </Button>
              <Button
                onClick={handleInviteUser}
                disabled={!inviteUsername.trim() || isInviting}
                className="bg-[#5865f2] hover:bg-[#4752c4] text-white px-6"
              >
                {isInviting ? 'Приглашение...' : 'Пригласить'}
              </Button>
            </div>
          </div>
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