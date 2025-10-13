'use client'

import React, { useState, useRef } from 'react'
import { X, Hash, Volume2, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Channel } from '../types'
import channelService from '../services/channelService'

interface ChannelSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  channel: Channel
  onChannelUpdate: (updatedChannel: Channel) => void
  onChannelDelete?: (channelId: number) => void
}

export function ChannelSettingsModal({ isOpen, onClose, channel, onChannelUpdate, onChannelDelete }: ChannelSettingsModalProps) {
  const [channelName, setChannelName] = useState(channel.name)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleSave = async () => {
    if (!channelName.trim()) {
      setError('Название канала не может быть пустым')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      let updatedChannel;
      if (channel.type === 'text') {
        updatedChannel = await channelService.updateTextChannel(channel.id, {
          name: channelName.trim(),
          position: channel.position
        })
      } else {
        updatedChannel = await channelService.updateVoiceChannel(channel.id, {
          name: channelName.trim(),
          position: channel.position
        })
      }

      onChannelUpdate({
        ...channel,
        name: updatedChannel.name
      })

      onClose()
    } catch (error: any) {
      console.error('Ошибка сохранения настроек канала:', error)
      setError(error.response?.data?.detail || 'Не удалось сохранить настройки канала')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteChannel = async () => {
    setIsDeleting(true)
    try {
      if (channel.type === 'text') {
        await channelService.deleteTextChannel(channel.id)
      } else {
        await channelService.deleteVoiceChannel(channel.id)
      }

      if (onChannelDelete) {
        onChannelDelete(channel.id)
      }

      onClose()
      console.log('Канал успешно удален')
    } catch (error: any) {
      console.error('Ошибка удаления канала:', error)
      setError(error.response?.data?.detail || 'Не удалось удалить канал')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleCancel = () => {
    setChannelName(channel.name)
    setError('')
    setShowDeleteConfirm(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-background w-[800px] h-[500px] rounded-lg shadow-xl flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-60 bg-secondary border-r border-border flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              {channel.type === 'text' ? (
                <Hash className="w-5 h-5" />
              ) : (
                <Volume2 className="w-5 h-5" />
              )}
              <h2 className="text-lg font-semibold truncate">{channel.name}</h2>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {channel.type === 'text' ? 'Текстовый канал' : 'Голосовой канал'}
            </p>
          </div>

          {/* Navigation */}
          <div className="flex-1 p-2">
            <div className="space-y-1">
              <button className="w-full text-left px-3 py-2 rounded text-sm bg-primary text-primary-foreground">
                Обзор
              </button>

              <div className="text-xs text-muted-foreground uppercase px-3 py-2 font-semibold">
                Права доступа
              </div>
              <button className="w-full text-left px-3 py-2 rounded text-sm text-muted-foreground hover:bg-accent transition opacity-50 cursor-not-allowed">
                Роли
              </button>
              <button className="w-full text-left px-3 py-2 rounded text-sm text-muted-foreground hover:bg-accent transition opacity-50 cursor-not-allowed">
                Участники
              </button>

              <div className="text-xs text-muted-foreground uppercase px-3 py-2 font-semibold">
                Интеграция
              </div>
              <button className="w-full text-left px-3 py-2 rounded text-sm text-muted-foreground hover:bg-accent transition opacity-50 cursor-not-allowed">
                Вебхуки
              </button>
            </div>
          </div>

          {/* Delete Channel Button */}
          <div className="p-2 border-t border-border">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full text-left px-3 py-2 rounded text-sm text-red-500 hover:bg-red-500/10 transition flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Удалить канал
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-border flex justify-between items-center">
            <h1 className="text-xl font-semibold">Обзор</h1>
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-accent rounded-full transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-2xl space-y-6">
              {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  {error}
                </div>
              )}

              {/* Channel Name */}
              <div>
                <label htmlFor="channelName" className="block text-sm font-medium mb-2">
                  Название канала
                </label>
                <input
                  id="channelName"
                  type="text"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  maxLength={100}
                  placeholder="Введите название канала"
                />
              </div>

              {/* Channel Type Info */}
              <div className="bg-secondary p-4 rounded-lg">
                <h3 className="font-medium mb-2">Информация о канале</h3>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>Тип канала: {channel.type === 'text' ? 'Текстовый' : 'Голосовой'}</p>
                  <p>ID канала: {channel.id}</p>
                  {channel.type === 'voice' && channel.max_users && (
                    <p>Максимум пользователей: {channel.max_users}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-border flex justify-end gap-3">
            <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={isLoading}>
              {isLoading ? 'Сохранение...' : 'Сохранить изменения'}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60">
          <div className="bg-background p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 text-red-500">Удалить канал</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Вы уверены, что хотите удалить канал <strong>"{channel.name}"</strong>?
              Это действие нельзя отменить. Все сообщения в канале будут удалены навсегда.
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Отмена
              </Button>
              <Button
                onClick={handleDeleteChannel}
                disabled={isDeleting}
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                {isDeleting ? 'Удаление...' : 'Удалить канал'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
