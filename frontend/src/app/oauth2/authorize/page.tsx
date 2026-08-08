'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { Bot, CheckCircle2, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

import api from '../../../services/api'

type OAuthPreview = {
  application: {
    id: string
    name: string
    icon: string | null
    description: string
    bot_public: boolean
    bot_require_code_grant: boolean
  }
  scopes: string[]
  response_type: string | null
  redirect_uri: string | null
  state: string | null
  permissions: string
  guild_id: string | null
  disable_guild_select: boolean
  integration_type: number
  installation_types: number[]
  already_user_installed: boolean
  code_challenge: string | null
  code_challenge_method: string | null
  servers: Array<{ id: string; name: string; icon: string | null }>
}

function requestErrorMessage(error: unknown) {
  const detail = (error as { response?: { data?: { detail?: string | { error_description?: string } } } }).response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail?.error_description) return detail.error_description
  return 'Не удалось авторизовать приложение.'
}

function OAuthAuthorizationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])
  const [preview, setPreview] = useState<OAuthPreview | null>(null)
  const [guildId, setGuildId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [error, setError] = useState('')

  const chooseInstallationType = (integrationType: number) => {
    const next = new URLSearchParams(searchParams.toString())
    next.set('integration_type', String(integrationType))
    if (!searchParams.has('scope')) {
      next.delete('permissions')
    }
    router.replace(`/oauth2/authorize?${next.toString()}`)
  }

  useEffect(() => {
    if (!query.client_id) {
      setError('В ссылке отсутствует client_id.')
      setLoading(false)
      return
    }
    let cancelled = false
    api.get<OAuthPreview>('/api/oauth2/authorize', { params: query })
      .then(({ data }) => {
        if (cancelled) return
        setPreview(data)
        setGuildId(data.guild_id || data.servers[0]?.id || '')
      })
      .catch((requestError) => {
        if (cancelled) return
        if ((requestError as { response?: { status?: number } }).response?.status === 401) {
          const destination = `${window.location.pathname}${window.location.search}`
          router.replace(`/login?redirect=${encodeURIComponent(destination)}`)
          return
        }
        setError(requestErrorMessage(requestError))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query, router])

  const authorize = async () => {
    if (!preview) return
    if (preview.scopes.includes('bot') && !guildId) {
      setError('Выберите сервер для установки бота.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const { data } = await api.post<{ authorized?: boolean; location?: string | null }>('/api/oauth2/authorize', {
        ...query,
        client_id: preview.application.id,
        scope: preview.scopes.join(' '),
        permissions: preview.permissions,
        guild_id: guildId || undefined,
        response_type: preview.response_type,
        redirect_uri: preview.redirect_uri,
        state: preview.state,
        code_challenge: preview.code_challenge,
        code_challenge_method: preview.code_challenge_method,
        integration_type: preview.integration_type,
      })
      if (data.location) {
        window.location.assign(data.location)
        return
      }
      setAuthorized(true)
    } catch (requestError) {
      setError(requestErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  const deny = () => {
    if (preview?.redirect_uri && preview.response_type) {
      const destination = new URL(preview.redirect_uri)
      destination.searchParams.set('error', 'access_denied')
      destination.searchParams.set('error_description', 'The resource owner denied the request')
      if (preview.state) destination.searchParams.set('state', preview.state)
      window.location.assign(destination.toString())
      return
    }
    router.push('/')
  }

  const isBotInstall = preview?.integration_type === 0 && (preview.scopes.includes('bot') ?? false)
  const isUserInstall = preview?.integration_type === 1

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#1e1f22] px-4 py-10 text-[#f2f3f5]">
      <section className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-[#2b2d31] shadow-2xl shadow-black/30">
        <div className="border-b border-white/10 bg-[#232428] px-6 py-7 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-[#5865f2]">
            {preview?.application.icon ? <img src={preview.application.icon} alt="" className="h-full w-full object-cover" /> : <Bot className="h-8 w-8" />}
          </div>
          <h1 className="text-2xl font-extrabold">Авторизация приложения</h1>
          <p className="mt-2 text-sm text-[#b5bac1]">Проверьте приложение, сервер и запрашиваемый доступ.</p>
        </div>
        <div className="p-6">
          {loading && <div className="flex min-h-52 items-center justify-center text-[#b5bac1]"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загружаем приложение…</div>}
          {!loading && error && <div role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">{error}</div>}
          {!loading && authorized && preview && (
            <div className="py-8 text-center"><CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-[#53d487]" /><h2 className="text-xl font-bold">{preview.application.name} авторизовано</h2><button onClick={() => router.push('/')} className="mt-6 min-h-11 rounded-xl bg-[#5865f2] px-5 font-bold hover:bg-[#4752c4]">Вернуться в Miscord</button></div>
          )}
          {!loading && !authorized && preview && (
            <div className="space-y-5">
              <div className="rounded-2xl bg-[#1e1f22] p-4"><h2 className="font-bold">{preview.application.name}</h2><p className="mt-1 text-sm text-[#949ba4]">{preview.application.description || 'Miscord Application'}</p></div>
              {preview.installation_types.length > 1 && !searchParams.has('scope') && (
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#b5bac1]">Куда установить</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => chooseInstallationType(0)} className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${preview.integration_type === 0 ? 'border-[#5865f2] bg-[#5865f2]/15 text-white' : 'border-white/10 bg-[#1e1f22] text-[#b5bac1]'}`}>На сервер</button>
                    <button type="button" onClick={() => chooseInstallationType(1)} className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${preview.integration_type === 1 ? 'border-[#5865f2] bg-[#5865f2]/15 text-white' : 'border-white/10 bg-[#1e1f22] text-[#b5bac1]'}`}>В мой аккаунт</button>
                  </div>
                </div>
              )}
              {isBotInstall && <div><label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#b5bac1]">Добавить на сервер</label><select value={guildId} disabled={preview.disable_guild_select} onChange={(event) => setGuildId(event.target.value)} className="min-h-12 w-full rounded-xl border border-white/10 bg-[#1e1f22] px-3 outline-none focus:border-[#5865f2]"><option value="" disabled>Выберите сервер</option>{preview.servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select></div>}
              {isUserInstall && <div className="rounded-2xl border border-white/10 bg-[#1e1f22] p-4 text-sm text-[#b5bac1]">Приложение будет доступно вашему аккаунту{preview.already_user_installed ? ' и обновит существующую установку' : ''}.</div>}
              <div className="rounded-2xl border border-white/10 p-4">
                <div className="mb-3 flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5 text-[#53d487]" /> Запрашиваемый доступ</div>
                <ul className="space-y-2 text-sm text-[#b5bac1]">{preview.scopes.map((scope) => <li key={scope} className="flex items-center gap-2"><KeyRound className="h-3.5 w-3.5" /> {scope}</li>)}</ul>
                {isBotInstall && <p className="mt-3 break-all font-mono text-xs text-[#949ba4]">permissions: {preview.permissions}</p>}
              </div>
              <div className="flex gap-3"><button onClick={deny} className="min-h-12 flex-1 rounded-xl bg-[#4e5058] font-bold hover:bg-[#5d6069]">Отмена</button><button disabled={submitting || (isBotInstall && !guildId)} onClick={() => void authorize()} className="min-h-12 flex-1 rounded-xl bg-[#5865f2] font-bold hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Авторизация…' : 'Авторизовать'}</button></div>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

export default function OAuthAuthorizationPage() {
  return <Suspense fallback={<main className="min-h-[100dvh] bg-[#1e1f22]" />}><OAuthAuthorizationContent /></Suspense>
}
