'use client'

import { useState } from 'react'
import { Plus, Home } from 'lucide-react'
import { useStore } from '../lib/store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  TextField,
  Box,
} from '@mui/material'
import channelService from '../services/channelService'

export function ServerList() {
  const { servers, currentServer, selectServer, addServer } = useStore()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelDescription, setNewChannelDescription] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) return

    setIsCreating(true)
    try {
      const newChannel = await channelService.createChannel({
        name: newChannelName,
        description: newChannelDescription || undefined,
      })

      // Преобразуем канал в формат сервера
      const newServer = {
        id: newChannel.id,
        name: newChannel.name,
        icon: undefined,
        channels: [
          ...newChannel.text_channels.map(tc => ({
            id: tc.id,
            name: tc.name,
            type: 'text' as const,
            serverId: newChannel.id,
          })),
          ...newChannel.voice_channels.map(vc => ({
            id: vc.id,
            name: vc.name,
            type: 'voice' as const,
            serverId: newChannel.id,
          })),
        ],
      }

      addServer(newServer)
      setIsCreateModalOpen(false)
      setNewChannelName('')
      setNewChannelDescription('')
    } catch (error) {
      console.error('Ошибка создания канала:', error)
    } finally {
      setIsCreating(false)
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
            <Button
              key={server.id}
              variant="ghost"
              size="icon"
              className={cn(
                "w-12 h-12 rounded-full transition-all hover:rounded-2xl",
                currentServer?.id === server.id && "bg-primary text-primary-foreground rounded-2xl"
              )}
              onClick={() => selectServer(server.id)}
            >
              {server.icon ? (
                <img src={server.icon} alt={server.name} className="w-full h-full rounded-full" />
              ) : (
                <span className="text-xs font-semibold">
                  {server.name.substring(0, 2).toUpperCase()}
                </span>
              )}
            </Button>
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

      {/* Create Channel Modal */}
      <Dialog open={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)}>
        <DialogContent>
          <DialogTitle>Создать новый канал</DialogTitle>
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Название канала"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Описание (необязательно)"
              value={newChannelDescription}
              onChange={(e) => setNewChannelDescription(e.target.value)}
              fullWidth
              multiline
              rows={3}
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
                onClick={handleCreateChannel}
                disabled={!newChannelName.trim() || isCreating}
              >
                {isCreating ? 'Создание...' : 'Создать'}
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  )
}