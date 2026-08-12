'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ClipboardCheck, Loader2 } from 'lucide-react'

import type { Server } from '../../types'
import { serverFeatureService, type MemberOnboardingSettings } from '../../services/serverFeatureService'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'


export function ServerOnboardingGate({ server }: { server: Server }) {
  const [config, setConfig] = useState<MemberOnboardingSettings | null>(null)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setConfig(null); setAnswers({}); setAccepted(false); setError('')
    void serverFeatureService.memberOnboarding(server.id)
      .then((value) => { if (current) setConfig(value) })
      .catch(() => undefined)
    return () => { current = false }
  }, [server.id])

  const requiredComplete = useMemo(() => (
    config?.prompts.every((prompt) => !prompt.required || (answers[prompt.id]?.length ?? 0) > 0) ?? false
  ), [answers, config])

  if (!config?.enabled || config.completed) return null

  const toggle = (promptId: string, optionId: string, multiple: boolean) => {
    setAnswers((current) => {
      const selected = current[promptId] ?? []
      return {
        ...current,
        [promptId]: multiple
          ? selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId]
          : [optionId],
      }
    })
  }

  const complete = async () => {
    setBusy(true); setError('')
    try {
      await serverFeatureService.completeOnboarding(server.id, accepted, answers)
      setConfig((value) => value ? { ...value, completed: true } : value)
    } catch (requestError: any) {
      setError(requestError.response?.data?.detail || 'Не удалось завершить настройку сервера.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[180] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <section className="my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <header className="border-b border-border bg-secondary/60 px-5 py-5 sm:px-7">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/15 text-primary"><ClipboardCheck className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Добро пожаловать</p><h2 id="onboarding-title" className="text-xl font-semibold">{server.name}</h2></div></div>
          {config.welcome_text && <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">{config.welcome_text}</p>}
        </header>
        <div className="max-h-[min(68vh,680px)] space-y-6 overflow-y-auto px-5 py-6 sm:px-7">
          {config.rules.length > 0 && <div><h3 className="font-semibold">Правила сервера</h3><div className="mt-3 space-y-2">{config.rules.map((rule, index) => <article key={rule.id} className="rounded-lg border border-border bg-secondary/35 p-3"><p className="text-sm font-medium">{index + 1}. {rule.title}</p>{rule.description && <p className="mt-1 text-sm leading-5 text-muted-foreground">{rule.description}</p>}</article>)}</div><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-primary/8 p-3 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>Я прочитал и принимаю правила сервера.</span></label></div>}
          {config.prompts.map((prompt) => <fieldset key={prompt.id}><legend className="font-semibold">{prompt.title}{prompt.required && <span className="ml-1 text-destructive">*</span>}</legend><p className="mt-1 text-xs text-muted-foreground">{prompt.multiple ? 'Можно выбрать несколько вариантов' : 'Выберите один вариант'}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{prompt.options.map((option) => { const active = answers[prompt.id]?.includes(option.id); return <button key={option.id} type="button" onClick={() => toggle(prompt.id, option.id, prompt.multiple)} className={cn('flex min-h-16 items-start gap-3 rounded-lg border p-3 text-left transition-colors', active ? 'border-primary bg-primary/12' : 'border-border bg-secondary/30 hover:bg-secondary')}><span className={cn('mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full border', active ? 'border-primary bg-primary text-white' : 'border-muted-foreground')}><Check className={cn('h-3 w-3', !active && 'opacity-0')} /></span><span><span className="block text-sm font-medium">{option.label}</span>{option.description && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>}</span></button> })}</div></fieldset>)}
          {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <footer className="flex items-center justify-between gap-4 border-t border-border px-5 py-4 sm:px-7"><p className="text-xs text-muted-foreground">Настройки каналов можно изменить позже.</p><Button disabled={busy || (config.rules.length > 0 && !accepted) || !requiredComplete} onClick={() => void complete()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Продолжить</Button></footer>
      </section>
    </div>
  )
}
