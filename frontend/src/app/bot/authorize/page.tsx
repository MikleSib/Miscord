'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { Bot, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

import botService from '../../../services/botService'
import type { BotAuthorizationPreview } from '../../../types/bot'

function errorMessage(error: any): string {
  return error?.response?.data?.detail || 'Не удалось выполнить авторизацию бота'
}

function AuthorizationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientId = searchParams.get('client_id') || ''
  const scope = searchParams.get('scope') || 'bot'
  const permissions = Number(searchParams.get('permissions') || 0)
  const [preview, setPreview] = useState<BotAuthorizationPreview | null>(null)
  const [serverId, setServerId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [error, setError] = useState('')
  const currentUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/bot/authorize'
    return `${window.location.pathname}${window.location.search}`
  }, [])

  useEffect(() => {
    if (!clientId || !Number.isFinite(permissions) || permissions < 0) {
      setError('Ссылка авторизации повреждена')
      setLoading(false)
      return
    }
    botService.getAuthorization(clientId, scope, permissions)
      .then((data) => {
        setPreview(data)
        setServerId(data.servers.find((server) => server.can_grant)?.id ?? null)
      })
      .catch((requestError) => {
        if (requestError?.response?.status === 401) {
          router.replace(`/login?redirect=${encodeURIComponent(currentUrl)}`)
          return
        }
        setError(errorMessage(requestError))
      })
      .finally(() => setLoading(false))
  }, [clientId, currentUrl, permissions, router, scope])

  const authorize = async () => {
    if (!serverId) return
    setSubmitting(true)
    setError('')
    try {
      await botService.authorize(clientId, serverId, scope, permissions)
      setInstalled(true)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mobile-public-page grid min-h-[100dvh] place-items-center bg-[#1e1f22] px-4 py-10 text-[#f2f3f5]">
      <section className="mobile-public-card w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-[#2b2d31] shadow-2xl shadow-black/30">
        <div className="border-b border-white/10 bg-[#232428] px-6 py-7 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-[#5865f2]"><Bot className="h-8 w-8" /></div>
          <h1 className="text-2xl font-extrabold">Добавить бота в Miscord</h1>
          <p className="mt-2 text-sm text-[#b5bac1]">Проверьте приложение, сервер и права перед авторизацией.</p>
        </div>
        <div className="p-6">
          {loading && <div className="flex min-h-48 items-center justify-center text-[#b5bac1]"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загружаем приложение...</div>}
          {!loading && error && <div className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">{error}</div>}
          {!loading && installed && preview && (
            <div className="py-8 text-center"><CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-[#53d487]" /><h2 className="text-xl font-bold">{preview.application.name} установлен</h2><button onClick={() => router.push('/app')} className="mt-6 min-h-11 rounded-xl bg-[#5865f2] px-5 font-bold hover:bg-[#4752c4]">Вернуться в Miscord</button></div>
          )}
          {!loading && !installed && preview && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 rounded-2xl bg-[#1e1f22] p-4"><div className="grid h-12 w-12 place-items-center rounded-xl bg-[#5865f2] font-bold">{preview.application.name.slice(0, 1).toUpperCase()}</div><div><h2 className="font-bold">{preview.application.name}</h2><p className="text-sm text-[#949ba4]">{preview.application.description || 'Bot Application'}</p></div></div>
              <div><label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#b5bac1]">Добавить на сервер</label><select value={serverId ?? ''} onChange={(event) => setServerId(Number(event.target.value))} className="min-h-12 w-full rounded-xl border border-white/10 bg-[#1e1f22] px-3 outline-none focus:border-[#5865f2]"><option value="" disabled>Выберите сервер</option>{preview.servers.map((server) => <option key={server.id} value={server.id} disabled={!server.can_grant}>{server.name}{server.already_installed ? ' (уже установлен)' : ''}{!server.can_grant ? ' (недостаточно прав)' : ''}</option>)}</select></div>
              <div className="rounded-2xl border border-white/10 p-4"><div className="mb-3 flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5 text-[#53d487]" /> Запрашиваемые права</div>{preview.permission_names.length ? <ul className="space-y-2 text-sm text-[#b5bac1]">{preview.permission_names.map((name) => <li key={name}>• {name}</li>)}</ul> : <p className="text-sm text-[#949ba4]">Специальные права не запрашиваются.</p>}</div>
              {!preview.servers.length && <p className="rounded-xl bg-[#1e1f22] p-3 text-sm text-[#b5bac1]">Нет серверов, которыми вы можете управлять.</p>}
              <div className="flex gap-3"><button onClick={() => router.push('/app')} className="min-h-12 flex-1 rounded-xl bg-[#4e5058] font-bold hover:bg-[#5d6069]">Отмена</button><button disabled={!serverId || submitting} onClick={authorize} className="min-h-12 flex-1 rounded-xl bg-[#5865f2] font-bold hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Авторизация...' : 'Авторизовать'}</button></div>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

export default function BotAuthorizationPage() {
  return <Suspense fallback={<main className="min-h-[100dvh] bg-[#1e1f22]" />}><AuthorizationContent /></Suspense>
}
