import { ChangeEvent, useCallback, useEffect, useState } from 'react'
import channelService from '../../services/channelService'
import { webhookService } from '../../services/webhookService'
import type { Channel } from '../../types'
import type { IncomingWebhook, WebhookUpdatePayload } from '../../types/webhook'

interface ChannelWebhooksTabProps {
  channel: Channel
}

interface ChannelOption {
  id: number
  name: string
}

const primaryButton =
  'inline-flex min-h-9 items-center justify-center rounded-md bg-[#5865f2] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4752c4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#aab2ff] disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'inline-flex min-h-9 items-center justify-center rounded-md bg-[#3b3d44] px-3 text-sm font-medium text-[#f2f3f5] transition-colors hover:bg-[#4a4d55] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#aab2ff] disabled:cursor-not-allowed disabled:opacity-50'
const dangerButton =
  'inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-[#fa777c] transition-colors hover:bg-[#4d2f33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fa777c] disabled:cursor-not-allowed disabled:opacity-50'
const inputClass =
  'min-h-10 w-full rounded-md border border-transparent bg-[#1e1f22] px-3 text-sm text-[#f2f3f5] outline-none transition-colors placeholder:text-[#7d818b] focus:border-[#5865f2]'

function getErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error
  ) {
    const response = (error as {
      response?: { data?: { detail?: string; message?: string } }
    }).response
    return response?.data?.detail || response?.data?.message || 'Не удалось выполнить действие.'
  }
  return 'Не удалось выполнить действие.'
}

function formatCreatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(date)
}

export default function ChannelWebhooksTab({ channel }: ChannelWebhooksTabProps) {
  const [items, setItems] = useState<IncomingWebhook[]>([])
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | 'create' | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [initialAvatarUrl, setInitialAvatarUrl] = useState('')
  const [targetChannelId, setTargetChannelId] = useState(channel.id)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [webhooks, server] = await Promise.all([
        webhookService.list(channel.id),
        channelService.getChannelDetails(channel.serverId),
      ])
      setItems(webhooks)
      const options = (server.text_channels || []).map((item) => ({
        id: item.id,
        name: item.name,
      }))
      setChannels(
        options.some((item) => item.id === channel.id)
          ? options
          : [{ id: channel.id, name: channel.name }, ...options],
      )
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [channel.id, channel.name, channel.serverId])

  useEffect(() => {
    void load()
  }, [load])

  const showNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3500)
  }

  const beginEdit = (webhook: IncomingWebhook) => {
    setEditingId(webhook.id)
    setName(webhook.name)
    setAvatarUrl(webhook.avatar_url || '')
    setInitialAvatarUrl(webhook.avatar_url || '')
    setTargetChannelId(webhook.channel_id)
    setError('')
  }

  const createWebhook = async () => {
    setBusy('create')
    setError('')
    try {
      const created = await webhookService.create(channel.id)
      setItems((current) => [...current, created])
      if (created.execution_url) {
        await navigator.clipboard.writeText(created.execution_url)
        showNotice('Вебхук создан. URL скопирован в буфер обмена.')
      } else {
        showNotice('Вебхук создан.')
      }
      beginEdit(created)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(null)
    }
  }

  const saveWebhook = async (webhook: IncomingWebhook) => {
    const cleanName = name.trim()
    if (!cleanName) {
      setError('Укажите имя вебхука.')
      return
    }

    setBusy(webhook.id)
    setError('')
    try {
      const payload: WebhookUpdatePayload = {
        name: cleanName,
        channel_id: targetChannelId,
      }
      if (avatarUrl !== initialAvatarUrl) {
        payload.avatar_url = avatarUrl.trim() || null
      }
      const updated = await webhookService.update(webhook.id, payload)
      if (updated.channel_id !== channel.id) {
        setItems((current) => current.filter((item) => item.id !== webhook.id))
        showNotice('Вебхук перемещён в другой канал.')
      } else {
        setItems((current) =>
          current.map((item) => (item.id === webhook.id ? updated : item)),
        )
        showNotice('Изменения сохранены.')
      }
      setEditingId(null)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(null)
    }
  }

  const uploadAvatar = async (
    webhook: IncomingWebhook,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setBusy(webhook.id)
    setError('')
    try {
      const updated = await webhookService.uploadAvatar(webhook.id, file)
      setItems((current) =>
        current.map((item) => (item.id === webhook.id ? updated : item)),
      )
      setAvatarUrl(updated.avatar_url || '')
      setInitialAvatarUrl(updated.avatar_url || '')
      showNotice('Аватар обновлён.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(null)
    }
  }

  const copyUrl = async (webhookId: number) => {
    setBusy(webhookId)
    setError('')
    try {
      const result = await webhookService.executionUrl(webhookId)
      await navigator.clipboard.writeText(result.execution_url)
      showNotice('URL вебхука скопирован.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(null)
    }
  }

  const resetToken = async (webhookId: number) => {
    if (!window.confirm('Старый URL сразу перестанет работать. Сбросить токен?')) {
      return
    }
    setBusy(webhookId)
    setError('')
    try {
      const result = await webhookService.resetToken(webhookId)
      await navigator.clipboard.writeText(result.execution_url)
      showNotice('Токен сброшен. Новый URL скопирован.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(null)
    }
  }

  const sendTest = async (webhookId: number) => {
    setBusy(webhookId)
    setError('')
    try {
      await webhookService.test(webhookId)
      showNotice('Тестовое сообщение отправлено без уведомлений.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(null)
    }
  }

  const removeWebhook = async (webhook: IncomingWebhook) => {
    if (!window.confirm('Удалить вебхук «' + webhook.name + '»? Его URL перестанет работать.')) {
      return
    }
    setBusy(webhook.id)
    setError('')
    try {
      await webhookService.remove(webhook.id)
      setItems((current) => current.filter((item) => item.id !== webhook.id))
      if (editingId === webhook.id) setEditingId(null)
      showNotice('Вебхук удалён.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#313338] px-5 pb-16 pt-16 text-[#f2f3f5] sm:px-10 lg:px-14">
      <div className="mx-auto w-full max-w-[760px]">
        <header className="border-b border-[#3f4147] pb-7 pr-12 sm:pr-16">
          <h1 className="text-xl font-bold tracking-[-0.02em]">
            Интеграция <span className="font-normal text-[#949ba4]">›</span> Вебхуки
          </h1>
          <p className="mt-3 max-w-[68ch] text-sm leading-5 text-[#b5bac1]">
            Вебхуки публикуют сообщения из внешних сервисов прямо в этот канал.
            Создайте вебхук, настройте имя и аватар, затем скопируйте секретный URL.
          </p>
          <button
            type="button"
            className={primaryButton + ' mt-5'}
            disabled={busy !== null}
            onClick={() => void createWebhook()}
          >
            {busy === 'create' ? 'Создание…' : 'Новый вебхук'}
          </button>
        </header>

        <div aria-live="polite" className="min-h-12 py-3">
          {error && (
            <div className="rounded-md bg-[#4d2f33] px-3 py-2 text-sm text-[#ffb9bd]">
              {error}
            </div>
          )}
          {!error && notice && (
            <div className="rounded-md bg-[#29463a] px-3 py-2 text-sm text-[#b8f2d2]">
              {notice}
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-10 text-sm text-[#b5bac1]">Загрузка вебхуков…</div>
        ) : items.length === 0 ? (
          <div className="border-b border-[#3f4147] py-10">
            <h2 className="text-base font-semibold">В этом канале пока нет вебхуков</h2>
            <p className="mt-2 max-w-[60ch] text-sm leading-5 text-[#949ba4]">
              После создания URL можно передать системе мониторинга, CI/CD или любому
              сервису, который умеет отправлять HTTP POST.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#3f4147] border-y border-[#3f4147]">
            {items.map((webhook) => {
              const isEditing = editingId === webhook.id
              const isBusy = busy === webhook.id
              return (
                <section key={webhook.id} className="py-5">
                  <div className="flex min-w-0 items-center gap-3">
                    {webhook.avatar_url ? (
                      <img
                        src={webhook.avatar_url}
                        alt=""
                        width={44}
                        height={44}
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="h-11 w-11 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#5865f2] text-base font-bold text-white">
                        {webhook.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#aab2ff]"
                      onClick={() => (isEditing ? setEditingId(null) : beginEdit(webhook))}
                    >
                      <span className="block truncate text-base font-semibold">
                        {webhook.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[#949ba4]">
                        Создан {webhook.creator?.display_name || webhook.creator?.username || 'пользователем'}
                        {formatCreatedAt(webhook.created_at) && ' · ' + formatCreatedAt(webhook.created_at)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => (isEditing ? setEditingId(null) : beginEdit(webhook))}
                    >
                      {isEditing ? 'Свернуть' : 'Настроить'}
                    </button>
                  </div>

                  {isEditing && (
                    <div className="mt-5 border-t border-[#3f4147] pt-5">
                      <div className="grid gap-5 md:grid-cols-[132px_minmax(0,1fr)]">
                        <div>
                          <div className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl bg-[#2b2d31]">
                            {avatarUrl ? (
                              <img
                                src={avatarUrl}
                                alt=""
                                width={96}
                                height={96}
                                decoding="async"
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="text-3xl font-bold text-[#b5bac1]">
                                {name.slice(0, 1).toUpperCase() || 'W'}
                              </span>
                            )}
                          </div>
                          <label className={secondaryButton + ' mt-3 w-full cursor-pointer'}>
                            Загрузить
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/gif,image/webp"
                              className="sr-only"
                              disabled={isBusy}
                              onChange={(event) => void uploadAvatar(webhook, event)}
                            />
                          </label>
                          <p className="mt-2 text-center text-xs leading-4 text-[#949ba4]">
                            PNG, JPG, GIF или WebP
                          </p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="block">
                            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.02em] text-[#b5bac1]">
                              Имя
                            </span>
                            <input
                              className={inputClass}
                              value={name}
                              maxLength={80}
                              onChange={(event) => setName(event.target.value)}
                            />
                          </label>
                          <label className="block">
                            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.02em] text-[#b5bac1]">
                              Канал
                            </span>
                            <select
                              className={inputClass}
                              value={targetChannelId}
                              onChange={(event) => setTargetChannelId(Number(event.target.value))}
                            >
                              {channels.map((option) => (
                                <option key={option.id} value={option.id}>
                                  # {option.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block sm:col-span-2">
                            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.02em] text-[#b5bac1]">
                              URL аватара
                            </span>
                            <input
                              type="url"
                              className={inputClass}
                              value={avatarUrl}
                              placeholder="https://example.com/avatar.png"
                              onChange={(event) => setAvatarUrl(event.target.value)}
                            />
                          </label>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-wrap gap-2 border-t border-[#3f4147] pt-4">
                        <button
                          type="button"
                          className={primaryButton}
                          disabled={isBusy}
                          onClick={() => void saveWebhook(webhook)}
                        >
                          Сохранить
                        </button>
                        <button
                          type="button"
                          className={secondaryButton}
                          disabled={isBusy}
                          onClick={() => void copyUrl(webhook.id)}
                        >
                          Копировать URL
                        </button>
                        <button
                          type="button"
                          className={secondaryButton}
                          disabled={isBusy}
                          onClick={() => void sendTest(webhook.id)}
                        >
                          Отправить тест
                        </button>
                        <button
                          type="button"
                          className={secondaryButton}
                          disabled={isBusy}
                          onClick={() => void resetToken(webhook.id)}
                        >
                          Сбросить токен
                        </button>
                        <button
                          type="button"
                          className={dangerButton}
                          disabled={isBusy}
                          onClick={() => void removeWebhook(webhook)}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}

        <section className="mt-8 pb-8">
          <h2 className="text-sm font-semibold">Быстрая проверка</h2>
          <p className="mt-2 text-sm leading-5 text-[#949ba4]">
            Скопированный URL является секретом. Не публикуйте его в логах и открытых
            репозиториях.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-[#1e1f22] p-4 text-xs leading-5 text-[#dbdee1]">
            <code>{'curl -H \"Content-Type: application/json\" \\\\\n  -d \\'{\"content\":\"Hello from Miscord\"}\\' WEBHOOK_URL'}</code>
          </pre>
        </section>
      </div>
    </div>
  )
}