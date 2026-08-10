'use client'

import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Hash, Loader2, MessageSquare, Mic2, Shield, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { communityApi } from '../../services/communityApi'
import type { ServerImport } from '../../types/community'

type Mode = 'template' | 'id'

function errorText(reason: any): string {
  return reason?.response?.data?.detail || 'Не удалось выполнить перенос'
}

export function ServerImportWizard({ onBack, onCreated }: {
  onBack: () => void
  onCreated: (serverId: number) => Promise<void>
}) {
  const [mode, setMode] = useState<Mode>('template')
  const [source, setSource] = useState('')
  const [job, setJob] = useState<ServerImport | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadJob = async (id: string) => {
    const next = await communityApi.getServerImport(id)
    setJob(next)
    if (next.name) setName((current) => current || next.name || '')
    return next
  }

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'miscord-server-import-oauth') return
      setLoading(true); setError('')
      void loadJob(String(event.data.importId)).catch((reason) => setError(errorText(reason))).finally(() => setLoading(false))
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])

  const preview = async () => {
    if (!source.trim()) return
    setLoading(true); setError('')
    try {
      if (mode === 'template') {
        const next = await communityApi.previewExternalTemplate(source.trim())
        setJob(next); setName(next.name || '')
      } else {
        if (!/^\d{17,20}$/.test(source.trim())) {
          throw new Error('ID должен содержать 17–20 цифр')
        }
        const started = await communityApi.startExternalServerOAuth(source.trim())
        window.open(started.authorize_url, 'miscord-server-import', 'popup,width=560,height=760')
      }
    } catch (reason: any) {
      setError(reason?.message?.startsWith('ID ') ? reason.message : errorText(reason))
    } finally { setLoading(false) }
  }

  const scan = async () => {
    if (!job) return
    setLoading(true); setError('')
    try {
      const next = await communityApi.scanServerImport(job.id)
      setJob(next); setName(next.name || name)
    } catch (reason) { setError(errorText(reason)) }
    finally { setLoading(false) }
  }

  const create = async () => {
    if (!job || !name.trim()) return
    setLoading(true); setError('')
    try {
      const result = await communityApi.createServerFromImport(job.id, { name: name.trim() })
      await onCreated(Number(result.id))
    } catch (reason) { setError(errorText(reason)) }
    finally { setLoading(false) }
  }

  const counts = useMemo(() => ({
    roles: job?.preview?.roles.length || 0,
    categories: job?.preview?.categories.length || 0,
    channels: job?.preview?.channels.length || 0,
  }), [job])

  return <div className="flex min-h-[560px] flex-col p-5">
    <button type="button" onClick={onBack} className="mb-3 inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:underline">
      <ArrowLeft className="h-4 w-4" /> К способам создания
    </button>
    <h2 className="text-2xl font-bold">Перенести сервер</h2>
    <p className="mt-1 max-w-2xl text-sm leading-6 text-text-quiet">Создаётся независимая копия структуры в Miscord. Участники, аккаунты, боты, токены, приглашения и журнал аудита не копируются.</p>
    {error && <p className="mt-4 rounded-md border border-red-400/20 bg-destructive/10 px-3 py-2 text-sm text-red-300">{error}</p>}

    {!job && <div className="mt-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => { setMode('template'); setError('') }} className={`rounded-xl border p-4 text-left ${mode === 'template' ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:bg-surface-raised'}`}>
          <Upload className="mb-3 h-5 w-5 text-primary" /><strong className="block">По ссылке-шаблону</strong><span className="mt-1 block text-xs leading-5 text-text-quiet">Быстрый перенос ролей, категорий, каналов и прав без установки бота.</span>
        </button>
        <button type="button" onClick={() => { setMode('id'); setError('') }} className={`rounded-xl border p-4 text-left ${mode === 'id' ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:bg-surface-raised'}`}>
          <Shield className="mb-3 h-5 w-5 text-primary" /><strong className="block">По ID сервера</strong><span className="mt-1 block text-xs leading-5 text-text-quiet">Проверка владения через OAuth и полный снимок доступной структуры.</span>
        </button>
      </div>
      <label htmlFor="external-server-source" className="mt-6 block text-xs font-bold uppercase tracking-wide text-text-quiet">{mode === 'template' ? 'Официальная ссылка-шаблон или код' : 'ID исходного сервера'}</label>
      <div className="mt-2 flex gap-2">
        <input id="external-server-source" value={source} onChange={(event) => setSource(event.target.value)} placeholder={mode === 'template' ? 'https://…/template-code' : '823212361677537281'} className="h-11 min-w-0 flex-1 rounded-md bg-canvas-deep px-3 outline-none focus:ring-2 focus:ring-primary" />
        <button type="button" onClick={() => void preview()} disabled={loading || !source.trim()} className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Продолжить'}</button>
      </div>
      <p className="mt-3 text-xs leading-5 text-text-quiet">ID используется только как адрес. Для защиты от копирования чужих закрытых серверов владелец должен подтвердить доступ.</p>
    </div>}

    {job?.status === 'awaiting_bot' && <div className="mt-8 rounded-xl border border-border bg-surface p-5">
      <h3 className="font-semibold">Доступ подтверждён</h3>
      <p className="mt-2 text-sm leading-6 text-text-quiet">Временно добавьте импортера на исходный сервер. После установки вернитесь сюда и запустите сканирование.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={job.bot_install_url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white">Установить импортера <ExternalLink className="h-4 w-4" /></a>
        <button type="button" onClick={() => void scan()} disabled={loading} className="h-10 rounded-md bg-surface-raised px-4 text-sm font-semibold hover:bg-white/10 disabled:opacity-50">{loading ? 'Сканирование…' : 'Импортер установлен — сканировать'}</button>
      </div>
    </div>}

    {job?.status === 'ready' && job.preview && <div className="mt-6 flex min-h-0 flex-1 flex-col gap-5 sm:flex-row">
      <div className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-border bg-surface p-4">
        <div className="grid grid-cols-3 gap-2">
          {[[Shield, counts.roles, 'ролей'], [MessageSquare, counts.categories, 'категорий'], [Hash, counts.channels, 'каналов']].map(([Icon, value, label]: any) => <div key={label} className="rounded-lg bg-canvas-deep p-3"><Icon className="mb-2 h-4 w-4 text-primary" /><strong className="block text-lg">{value}</strong><span className="text-xs text-text-quiet">{label}</span></div>)}
        </div>
        <div className="mt-4 space-y-3">{job.preview.categories.map((category) => <section key={category.key}><h4 className="text-xs font-semibold uppercase text-text-quiet">{category.name}</h4>{job.preview!.channels.filter((channel) => channel.category_key === category.key).map((channel) => <div key={channel.key} className="mt-1 flex items-center gap-2 rounded px-2 py-1 text-sm">{channel.type === 'voice' ? <Mic2 className="h-4 w-4" /> : <Hash className="h-4 w-4" />}{channel.name}</div>)}</section>)}</div>
      </div>
      <div className="w-full sm:w-72">
        <label htmlFor="imported-server-name" className="text-xs font-bold uppercase tracking-wide text-text-quiet">Название нового сервера</label>
        <input id="imported-server-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3 outline-none focus:ring-2 focus:ring-primary" />
        {job.warnings.length > 0 && <div className="mt-4 max-h-52 overflow-y-auto rounded-lg border border-amber-400/20 bg-amber-400/5 p-3"><p className="flex items-center gap-2 text-xs font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" /> Особенности переноса</p><ul className="mt-2 space-y-1 text-xs leading-5 text-text-quiet">{job.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></div>}
        <button type="button" onClick={() => void create()} disabled={loading || !name.trim()} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-white disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4" /> Создать в Miscord</>}</button>
      </div>
    </div>}
  </div>
}
