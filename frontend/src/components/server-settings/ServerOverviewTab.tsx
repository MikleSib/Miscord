'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react'

import { Button } from '../ui/button'
import channelService from '../../services/channelService'
import uploadService from '../../services/uploadService'
import { Permissions } from '../../lib/permissions'
import { useServerPermissions } from '../../lib/serverPermissions'
import { useStore } from '../../lib/store'
import { cn } from '../../lib/utils'
import { resolveMediaUrl } from '../../lib/mediaUrl'
import { Server } from '../../types'
import { ErrorBanner, FieldLabel, Section, TabShell, TextInput, Toggle } from './layout'

interface ServerOverviewTabProps {
  server: Server
  onServerUpdate: (updatedServer: Server) => void
}

const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 300

export function ServerOverviewTab({ server, onServerUpdate }: ServerOverviewTabProps) {
  const { can } = useServerPermissions(server.id)
  const canManage = can(Permissions.MANAGE_SERVER)
  const updateServerInStore = useStore((state) => state.updateServer)

  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description || '')
  const [icon, setIcon] = useState<string | null>(server.icon || null)
  const [banner, setBanner] = useState<string | null>(server.banner || null)
  const [isPublic, setIsPublic] = useState(Boolean(server.is_public))

  const [isSaving, setIsSaving] = useState(false)
  const [uploadingTarget, setUploadingTarget] = useState<'icon' | 'banner' | null>(null)
  const [error, setError] = useState('')
  const [iconLoadFailed, setIconLoadFailed] = useState(false)

  const iconInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(server.name)
    setDescription(server.description || '')
    setIcon(server.icon || null)
    setBanner(server.banner || null)
    setIsPublic(Boolean(server.is_public))
    setIconLoadFailed(false)
    setError('')
  }, [server.id, server.name, server.description, server.icon, server.banner, server.is_public])

  const trimmedName = name.trim()

  const hasChanges = useMemo(() => {
    return (
      trimmedName !== server.name ||
      description.trim() !== (server.description || '') ||
      (icon || null) !== (server.icon || null) ||
      (banner || null) !== (server.banner || null) ||
      isPublic !== Boolean(server.is_public)
    )
  }, [trimmedName, description, icon, banner, isPublic, server])

  const createdAtLabel = useMemo(() => {
    if (!server.created_at) return null
    const parsed = new Date(server.created_at)
    if (Number.isNaN(parsed.getTime())) return null
    return format(parsed, 'd MMMM yyyy', { locale: ru })
  }, [server.created_at])

  const handleUpload = async (file: File, target: 'icon' | 'banner') => {
    setUploadingTarget(target)
    setError('')
    try {
      const { file_url } = await uploadService.uploadFile(file)
      if (target === 'icon') {
        setIcon(file_url)
        setIconLoadFailed(false)
      } else {
        setBanner(file_url)
      }
    } catch (uploadError) {
      console.error('Ошибка загрузки изображения:', uploadError)
      setError('Не удалось загрузить изображение. Попробуйте другой файл.')
    } finally {
      setUploadingTarget(null)
    }
  }

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    target: 'icon' | 'banner'
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('Выберите файл изображения')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Изображение слишком большое — максимум 8 МБ')
      return
    }
    void handleUpload(file, target)
  }

  const handleReset = () => {
    setName(server.name)
    setDescription(server.description || '')
    setIcon(server.icon || null)
    setBanner(server.banner || null)
    setIsPublic(Boolean(server.is_public))
    setError('')
  }

  const handleSave = async () => {
    if (!trimmedName) {
      setError('Название сервера не может быть пустым')
      return
    }

    setIsSaving(true)
    setError('')
    try {
      // Явный null нужен, чтобы бэкенд понял «убрать», а не «не менять»
      await channelService.updateServer(server.id, {
        name: trimmedName,
        description: description.trim(),
        icon: icon,
        banner: banner,
        is_public: isPublic,
      })

      const patch: Partial<Server> = {
        name: trimmedName,
        description: description.trim(),
        icon: icon || undefined,
        banner,
        is_public: isPublic,
      }
      updateServerInStore(server.id, patch)
      onServerUpdate({ ...server, ...patch })
    } catch (saveError: any) {
      console.error('Ошибка сохранения настроек сервера:', saveError)
      setError(saveError.response?.data?.detail || 'Не удалось сохранить изменения')
    } finally {
      setIsSaving(false)
    }
  }

  const iconUrl = resolveMediaUrl(icon)
  const bannerUrl = resolveMediaUrl(banner)

  return (
    <TabShell
      footer={
        canManage && hasChanges ? (
          <div className="flex items-center justify-end gap-3">
            <span className="mr-auto text-sm text-muted-foreground">Есть несохранённые изменения</span>
            <Button variant="ghost" onClick={handleReset} disabled={isSaving}>
              Сбросить
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !trimmedName}>
              {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
            </Button>
          </div>
        ) : undefined
      }
    >
      <ErrorBanner message={error} />

      {!canManage && (
        <div className="mb-6 rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
          У вас нет права «Управлять сервером», поэтому настройки доступны только для просмотра.
        </div>
      )}

      {/* Баннер и иконка */}
      <Section title="Внешний вид">
        <div className="overflow-hidden rounded-lg border border-border">
          <div
            className={cn(
              'relative h-32 w-full bg-gradient-to-br from-primary/30 to-primary/5',
              banner && 'bg-none'
            )}
          >
            {bannerUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={bannerUrl}
                src={bannerUrl}
                alt="Баннер сервера"
                className="h-full w-full object-cover"
              />
            )}
            {uploadingTarget === 'banner' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 bg-secondary/40 px-4 py-4">
            <div className="relative -mt-12 h-20 w-20 flex-none overflow-hidden rounded-full border-4 border-background bg-primary">
              {iconUrl && !iconLoadFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={iconUrl}
                  src={iconUrl}
                  alt="Иконка сервера"
                  className="h-full w-full object-cover"
                  onError={() => setIconLoadFailed(true)}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-primary-foreground">
                  {server.name.charAt(0).toUpperCase()}
                </div>
              )}
              {uploadingTarget === 'icon' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </div>
              )}
            </div>

            <div className="flex flex-1 flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canManage || uploadingTarget !== null}
                onClick={() => iconInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                Иконка
              </Button>
              {icon && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canManage || uploadingTarget !== null}
                  onClick={() => setIcon(null)}
                  className="text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Убрать иконку
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                disabled={!canManage || uploadingTarget !== null}
                onClick={() => bannerInputRef.current?.click()}
              >
                <ImagePlus className="mr-2 h-4 w-4" />
                Баннер
              </Button>
              {banner && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canManage || uploadingTarget !== null}
                  onClick={() => setBanner(null)}
                  className="text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Убрать баннер
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          Иконка — минимум 128×128, баннер — рекомендуется 960×540. До 8 МБ, форматы JPG, PNG, GIF.
        </p>

        <input
          ref={iconInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => handleFileChange(event, 'icon')}
        />
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => handleFileChange(event, 'banner')}
        />
      </Section>

      {/* Название и описание */}
      <Section title="Основное">
        <div className="mb-4">
          <FieldLabel>Название сервера</FieldLabel>
          <TextInput
            value={name}
            maxLength={MAX_NAME_LENGTH}
            disabled={!canManage}
            onChange={(event) => setName(event.target.value)}
            placeholder="Название сервера"
          />
        </div>

        <div>
          <FieldLabel>Описание</FieldLabel>
          <textarea
            value={description}
            maxLength={MAX_DESCRIPTION_LENGTH}
            disabled={!canManage}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            placeholder="Расскажите, о чём этот сервер"
            className="w-full resize-none rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {description.length}/{MAX_DESCRIPTION_LENGTH}
          </p>
        </div>
      </Section>

      {/* Доступность */}
      <Section title="Доступность">
        <Toggle
          checked={isPublic}
          disabled={!canManage}
          onChange={setIsPublic}
          label="Открытый сервер"
          description={
            isPublic
              ? 'Любой участник может создавать ссылки-приглашения. Если выключить — все текущие ссылки сразу перестанут работать.'
              : 'Сервер закрыт: войти можно только по новой ссылке от человека с правом «Создавать приглашения». Старые ссылки не действуют.'
          }
        />
      </Section>

      {/* Информация */}
      <Section title="Информация о сервере">
        <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-muted-foreground">Идентификатор</dt>
            <dd className="font-mono text-sm">{server.id}</dd>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-muted-foreground">Дата создания</dt>
            <dd className="text-sm">{createdAtLabel || 'Неизвестно'}</dd>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-muted-foreground">Каналов</dt>
            <dd className="text-sm">{server.channels.length}</dd>
          </div>
          {typeof server.members_count === 'number' && (
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted-foreground">Участников</dt>
              <dd className="text-sm">{server.members_count}</dd>
            </div>
          )}
        </dl>
      </Section>
    </TabShell>
  )
}
