'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, FlaskConical, Loader2, Plus, RefreshCw, Save, Trash2, Webhook as WebhookIcon } from 'lucide-react'

import webhookService from '../../services/webhookService'
import { IncomingWebhook } from '../../types/webhook'
import { Channel } from '../../types'
import { Button } from '../ui/button'


interface ChannelWebhooksTabProps {
  channel: Channel
}


function errorText(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if ((error as { response?: { status?: number } })?.response?.status === 403) {
    return 'У вас нет права управлять вебхуками этого канала.'
  }
  if ((error as { response?: { status?: number } })?.response?.status === 429) {
    return 'Слишком много запросов. Подождите и повторите действие.'
  }
  return 'Не удалось выполнить действие. Проверьте соединение и повторите.'
}


async function copySecret(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    return
  } catch {
    const input = document.createElement('textarea')
    input.value = value
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    const copied = document.execCommand('copy')
    input.value = ''
    input.remove()
    if (!copied) throw new Error('Clipboard is unavailable')
  }
}


export function ChannelWebhooksTab({ channel }: ChannelWebhooksTabProps) {
  const [items, setItems] = useState<IncomingWebhook[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | 'create' | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await webhookService.list(channel.id))
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setLoading(false)
    }
  }, [channel.id])

  useEffect(() => {
    void load()
  }, [load])

  const beginEdit = (item: IncomingWebhook) => {
    setEditingId(item.id)
    setName(item.name)
    setAvatarUrl(item.avatar_url || '')
    setError('')
    setNotice('')
  }

  const createWebhook = async () => {
    setBusyId('create')
    setError('')
    setNotice('')
    try {
      const created = await webhookService.create(channel.id, { name: 'Новый вебхук' })
      setItems((current) => [...current, created])
      await copySecret(created.execution_url)
      setCopiedId(created.id)
      setNotice('Вебхук создан, URL скопирован. Сохраните его в интеграции как секрет.')
      beginEdit(created)
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setBusyId(null)
    }
  }

  const saveWebhook = async (item: IncomingWebhook) => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Введите имя вебхука.')
      return
    }
    setBusyId(item.id)
    setError('')
    try {
      const updated = await webhookService.update(item.id, { name: trimmed, avatar_url: avatarUrl.trim() || null })
      setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
      setNotice('Изменения сохранены.')
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setBusyId(null)
    }
  }

  const copyUrl = async (item: IncomingWebhook) => {
    setBusyId(item.id)
    setError('')
    try {
      const url = await webhookService.executionUrl(item.id)
      await copySecret(url)
      setCopiedId(item.id)
      setNotice('URL скопирован. Не публикуйте его: токен дает право отправлять сообщения.')
      window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 2500)
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setBusyId(null)
    }
  }

  const resetToken = async (item: IncomingWebhook) => {
    if (!window.confirm('Старый URL сразу перестанет работать. Сбросить токен?')) return
    setBusyId(item.id)
    setError('')
    try {
      const url = await webhookService.resetToken(item.id)
      await copySecret(url)
      setCopiedId(item.id)
      setNotice('Токен сброшен, новый URL скопирован.')
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setBusyId(null)
    }
  }

  const sendTest = async (item: IncomingWebhook) => {
    setBusyId(item.id)
    setError('')
    try {
      await webhookService.test(item.id)
      setNotice(`Тихое тестовое сообщение отправлено в #${channel.name}.`)
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setBusyId(null)
    }
  }

  const removeWebhook = async (item: IncomingWebhook) => {
    if (!window.confirm(`Удалить вебхук «${item.name}»? Его URL перестанет работать.`)) return
    setBusyId(item.id)
    setError('')
    try {
      await webhookService.remove(item.id)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      if (editingId === item.id) setEditingId(null)
      setNotice('Вебхук удален. Ранее отправленные сообщения сохранены.')
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto px-5 pb-16 pt-16 sm:px-10">
      <div className="mx-auto w-full max-w-[720px]">
        <div className="mb-8 border-b border-[#3f4147] pb-6 pr-14 sm:pr-20">
          <div className="max-w-[60ch]">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-white">Вебхуки</h1>
            <p className="mt-2 text-[15px] leading-6 text-[#b5bac1]">
              Отправляйте уведомления из CI, мониторинга и внешних сервисов прямо в #{channel.name}.
            </p>
          </div>
          <Button onClick={() => void createWebhook()} disabled={busyId !== null} className="mt-5 shrink-0">
            {busyId === 'create' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Создать
          </Button>
        </div>

        <div aria-live="polite" className="mb-4 min-h-6">
          {error && <div className="rounded-lg bg-[#f23f4220] px-3 py-2 text-sm text-[#ffb4b7]">{error}</div>}
          {!error && notice && <div className="rounded-lg bg-[#23a55920] px-3 py-2 text-sm text-[#9ee8bd]">{notice}</div>}
        </div>

        {loading ? (
          <div className="flex items-center gap-3 py-12 text-[#b5bac1]"><Loader2 className="h-5 w-5 animate-spin" />Загружаем вебхуки…</div>
        ) : items.length === 0 ? (
          <div className="border-y border-[#3f4147] py-14 text-center">
            <WebhookIcon className="mx-auto h-9 w-9 text-[#80848e]" />
            <h2 className="mt-4 text-lg font-medium text-white">В этом канале пока нет вебхуков</h2>
            <p className="mx-auto mt-2 max-w-[48ch] text-sm leading-6 text-[#b5bac1]">Создайте первый URL и подключите к нему сборку, алерты или собственный сервис.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#3f4147] border-y border-[#3f4147]">
            {items.map((item) => {
              const editing = editingId === item.id
              const busy = busyId === item.id
              return (
                <section key={item.id} className="py-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#5865f2] text-white">
                      {item.avatar_url ? <img src={item.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <WebhookIcon className="h-5 w-5" />}
                    </div>
                    <button type="button" onClick={() => beginEdit(item)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865f2]">
                      <span className="block truncate font-medium text-white">{item.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-[#949ba4]">Создал: {item.creator?.display_name || item.creator?.username || 'Удаленный аккаунт'}</span>
                    </button>
                    <Button variant="ghost" size="sm" onClick={() => beginEdit(item)}>Настроить</Button>
                  </div>

                  {editing && (
                    <div className="mt-5 grid gap-4 pl-0 sm:pl-14">
                      <label className="grid gap-1.5 text-sm font-medium text-[#dbdee1]">
                        Имя
                        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={busy} className="h-10 rounded-md border border-[#1e1f22] bg-[#1e1f22] px-3 text-base text-white outline-none transition focus:border-[#5865f2] disabled:opacity-60" />
                      </label>
                      <label className="grid gap-1.5 text-sm font-medium text-[#dbdee1]">
                        HTTPS URL аватара
                        <input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} type="url" inputMode="url" placeholder="https://…" disabled={busy} className="h-10 rounded-md border border-[#1e1f22] bg-[#1e1f22] px-3 text-base text-white outline-none transition placeholder:text-[#6d6f78] focus:border-[#5865f2] disabled:opacity-60" />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={busy} onClick={() => void saveWebhook(item)}><Save className="mr-2 h-4 w-4" />Сохранить</Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void copyUrl(item)}>{copiedId === item.id ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}Копировать URL</Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void sendTest(item)}><FlaskConical className="mr-2 h-4 w-4" />Тест</Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void resetToken(item)}><RefreshCw className="mr-2 h-4 w-4" />Сбросить токен</Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void removeWebhook(item)} className="text-[#f23f42] hover:text-[#ff6b6e]"><Trash2 className="mr-2 h-4 w-4" />Удалить</Button>
                      </div>
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-base font-semibold text-white">Быстрый старт</h2>
          <p className="mt-1 text-sm leading-6 text-[#b5bac1]">Передайте скопированный URL как секрет окружения и отправьте JSON:</p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-[#1e1f22] p-4 text-xs leading-5 text-[#dbdee1]"><code>{`curl -H "Content-Type: application/json" \\\n+  -d '{"content":"Сборка завершена"}' \\\n+  "$MISCORD_WEBHOOK_URL?wait=true"`}</code></pre>
        </div>
      </div>
    </div>
  )
}
