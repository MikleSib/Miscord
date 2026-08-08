'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, Loader2, Trash2 } from 'lucide-react'
import botService from '../../services/botService'
import type { InstalledBot } from '../../types/bot'
import type { Server } from '../../types'
import { EmptyState, ErrorBanner, TabShell } from './layout'

export function ServerBotsTab({ server }: { server: Server }) {
  const [bots, setBots] = useState<InstalledBot[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<number | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      setBots(await botService.listInstalled(server.id))
    } catch (requestError: any) {
      setError(requestError?.response?.data?.detail || 'Не удалось загрузить установленных ботов')
    } finally {
      setLoading(false)
    }
  }, [server.id])
  useEffect(() => { void load() }, [load])
  const uninstall = async (bot: InstalledBot) => {
    if (!window.confirm(`Удалить ${bot.application.name} с сервера? Старые сообщения останутся.`)) return
    setRemoving(bot.application.id)
    setError('')
    try {
      await botService.uninstall(server.id, bot.application.id)
      setBots((current) => current.filter((item) => item.application.id !== bot.application.id))
    } catch (requestError: any) {
      setError(requestError?.response?.data?.detail || 'Не удалось удалить бота')
    } finally {
      setRemoving(null)
    }
  }
  return (
    <TabShell>
      <ErrorBanner message={error} />
      {loading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загружаем ботов...</div>
      ) : bots.length === 0 ? (
        <EmptyState icon={Bot} title="На сервере нет ботов" description="Установите бота через invite-link из Developer Portal." />
      ) : (
        <div className="space-y-3">{bots.map((item) => (
          <article key={item.application.id} className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
            <div className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-[#5865f2] font-bold text-white">{item.application.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate font-semibold">{item.application.name}</h3><span className="rounded bg-[#5865f2] px-1.5 py-0.5 text-[10px] font-bold text-white">BOT</span></div><p className="mt-1 truncate text-sm text-muted-foreground">{item.permission_names.join(', ') || 'Без специальных прав'}</p></div>
            <button type="button" disabled={removing === item.application.id} onClick={() => uninstall(item)} className="grid h-11 w-11 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50" aria-label={`Удалить ${item.application.name}`}><Trash2 className="h-4 w-4" /></button>
          </article>
        ))}</div>
      )}
    </TabShell>
  )
}
