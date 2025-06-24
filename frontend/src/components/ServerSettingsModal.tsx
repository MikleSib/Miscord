'use client'

import React, { useState, useRef } from 'react'
import { X, Camera, Upload, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Server } from '../types'
import channelService from '../services/channelService'
import uploadService from '../services/uploadService'

interface ServerSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  server: Server
  onServerUpdate: (updatedServer: Server) => void
}

export function ServerSettingsModal({ isOpen, onClose, server, onServerUpdate }: ServerSettingsModalProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [serverName, setServerName] = useState(server.name)
  const [serverDescription, setServerDescription] = useState(server.description || '')
  const [serverIcon, setServerIcon] = useState(server.icon || '')
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Проверяем размер файла (максимум 5МБ)
      if (file.size > 5 * 1024 * 1024) {
        setError('Размер файла не должен превышать 5МБ')
        return
      }
      
      // Проверяем тип файла
      if (!file.type.startsWith('image/')) {
        setError('Файл должен быть изображением')
        return
      }
      
      setIconFile(file)
      setError('')
      
      // Создаем превью
      const reader = new FileReader()
      reader.onload = (e) => {
        setIconPreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSave = async () => {
    if (!serverName.trim()) {
      setError('Название сервера не может быть пустым')
      return
    }

    setIsLoading(true)
    setError('')
    
    try {
      let iconUrl = serverIcon

      // Загружаем новую иконку если выбрана
      if (iconFile) {
        const uploadResponse = await uploadService.uploadFile(iconFile)
        iconUrl = uploadResponse.file_url
      }

      // Обновляем сервер
      const updatedServer = await channelService.updateServer(server.id, {
        name: serverName.trim(),
        description: serverDescription.trim() || undefined,
        icon: iconUrl || undefined
      })

      // Обновляем сервер в родительском компоненте
      onServerUpdate({
        ...server,
        name: updatedServer.name,
        description: updatedServer.description,
        icon: updatedServer.icon
      })

      onClose()
    } catch (error: any) {
    
      setError(error.response?.data?.detail || 'Не удалось сохранить настройки сервера')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteServer = async () => {
    setIsDeleting(true)
    try {
      await channelService.deleteServer(server.id)
      // Закрываем модальное окно - WebSocket уведомление автоматически обновит состояние
      onClose()
   
    } catch (error: any) {
   
      setError(error.response?.data?.detail || 'Не удалось удалить сервер')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleCancel = () => {
    setServerName(server.name)
    setServerDescription(server.description || '')
    setServerIcon(server.icon || '')
    setIconFile(null)
    setIconPreview(null)
    setError('')
    setShowDeleteConfirm(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-background w-[960px] h-[640px] rounded-lg shadow-xl flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-60 bg-secondary border-r border-border flex flex-col">
          <div className="p-4 border-b border-border">
            <h2 className="text-lg font-semibold">{server.name}</h2>
          </div>
          
          {/* Navigation */}
          <div className="flex-1 p-2">
            <div className="space-y-1">
              <button
                onClick={() => setActiveTab('overview')}
                className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                  activeTab === 'overview' 
                    ? 'bg-primary text-primary-foreground' 
                    : 'hover:bg-accent text-muted-foreground'
                }`}
              >
                Профиль сервера
              </button>
              
              <div className="text-xs text-muted-foreground uppercase px-3 py-2 font-semibold">
                Пользователи
              </div>
              <button className="w-full text-left px-3 py-2 rounded text-sm text-muted-foreground hover:bg-accent transition opacity-50 cursor-not-allowed">
                Участники
              </button>
              <button className="w-full text-left px-3 py-2 rounded text-sm text-muted-foreground hover:bg-accent transition opacity-50 cursor-not-allowed">
                Роли
              </button>
              <button className="w-full text-left px-3 py-2 rounded text-sm text-muted-foreground hover:bg-accent transition opacity-50 cursor-not-allowed">
                Приглашения
              </button>
              
              <div className="text-xs text-muted-foreground uppercase px-3 py-2 font-semibold">
                Модерация
              </div>
              <button className="w-full text-left px-3 py-2 rounded text-sm text-muted-foreground hover:bg-accent transition opacity-50 cursor-not-allowed">
                Журнал аудита
              </button>
              <button className="w-full text-left px-3 py-2 rounded text-sm text-muted-foreground hover:bg-accent transition opacity-50 cursor-not-allowed">
                Автомодерация
              </button>
              
              <div className="text-xs text-muted-foreground uppercase px-3 py-2 font-semibold">
                Приложения
              </div>
              <button className="w-full text-left px-3 py-2 rounded text-sm text-muted-foreground hover:bg-accent transition opacity-50 cursor-not-allowed">
                Интеграции
              </button>
              <button className="w-full text-left px-3 py-2 rounded text-sm text-muted-foreground hover:bg-accent transition opacity-50 cursor-not-allowed">
                Виджеты сервера
              </button>
            </div>
          </div>

          {/* Delete Server Button */}
          <div className="p-2 border-t border-border">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full text-left px-3 py-2 rounded text-sm text-red-500 hover:bg-red-500/10 transition flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Удалить сервер
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-border flex justify-between items-center">
            <h1 className="text-xl font-semibold">
              {activeTab === 'overview' && 'Профиль сервера'}
            </h1>
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-accent rounded-full transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          {activeTab === 'overview' && (
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="max-w-2xl space-y-6">
                {error && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                    {error}
                  </div>
                )}

                {/* Server Icon */}
                <div>
                  <label className="block text-sm font-medium mb-2">Значок сервера</label>
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-semibold overflow-hidden">
                        {iconPreview || serverIcon ? (
                          <img 
                            src={iconPreview || serverIcon} 
                            alt="Server icon" 
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          server.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute -bottom-1 -right-1 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 transition"
                      >
                        <Camera className="w-3 h-3" />
                      </button>
                    </div>
                    <div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition flex items-center gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        Загрузить изображение
                      </button>
                      <p className="text-xs text-muted-foreground mt-1">
                        Рекомендуется размер 512x512. Максимум 5МБ.
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleIconChange}
                    className="hidden"
                  />
                </div>

                {/* Server Name */}
                <div>
                  <label htmlFor="serverName" className="block text-sm font-medium mb-2">
                    Название сервера
                  </label>
                  <input
                    id="serverName"
                    type="text"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    maxLength={100}
                    placeholder="Введите название сервера"
                  />
                </div>

                {/* Server Description */}
                <div>
                  <label htmlFor="serverDescription" className="block text-sm font-medium mb-2">
                    Описание сервера
                  </label>
                  <textarea
                    id="serverDescription"
                    value={serverDescription}
                    onChange={(e) => setServerDescription(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    rows={3}
                    maxLength={500}
                    placeholder="Краткое описание сервера"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {serverDescription.length}/500
                  </p>
                </div>

                {/* Server Info */}
                <div className="bg-secondary p-4 rounded-lg">
                  <h3 className="font-medium mb-2">Информация о сервере</h3>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>ID сервера: {server.id}</p>
                    <p>Дата создания: {new Date().toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

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
            <h3 className="text-lg font-semibold mb-4 text-red-500">Удалить сервер</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Вы уверены, что хотите удалить сервер <strong>"{server.name}"</strong>? 
              Это действие нельзя отменить. Все каналы и сообщения будут удалены навсегда.
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
                onClick={handleDeleteServer}
                disabled={isDeleting}
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                {isDeleting ? 'Удаление...' : 'Удалить сервер'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 