'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import type { Server } from '../../types'
import { serverFeatureService, type OnboardingSettings } from '../../services/serverFeatureService'
import { Button } from '../ui/button'
import { ErrorBanner, FieldLabel, Section, TabShell, TextInput, Toggle } from './layout'


const id = () => crypto.randomUUID()

export function ServerOnboardingTab({ server }: { server: Server }) {
  const [value, setValue] = useState<OnboardingSettings | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const textChannels = server.channels.filter((channel) => channel.type === 'text' && (!channel.kind || channel.kind === 'text'))

  useEffect(() => {
    void serverFeatureService.onboarding(server.id).then(setValue).catch(() => setError('Не удалось загрузить onboarding.'))
  }, [server.id])

  if (!value) return <TabShell><ErrorBanner message={error} /><p className="text-sm text-muted-foreground">Загрузка…</p></TabShell>

  const save = async () => {
    setSaving(true); setError('')
    try {
      setValue(await serverFeatureService.saveOnboarding(server.id, {
        enabled: value.enabled, welcome_text: value.welcome_text,
        rules: value.rules, prompts: value.prompts, default_channel_ids: value.default_channel_ids,
      }))
    } catch (requestError: any) {
      setError(requestError.response?.data?.detail || 'Не удалось сохранить onboarding.')
    } finally { setSaving(false) }
  }

  return (
    <TabShell footer={<div className="flex justify-end"><Button disabled={saving} onClick={() => void save()}>{saving ? 'Сохраняем…' : 'Сохранить onboarding'}</Button></div>}>
      <ErrorBanner message={error} />
      <Section title="Первый вход" description="Новые участники принимают правила и выбирают интересующие каналы до начала общения.">
        <Toggle checked={value.enabled} onChange={(enabled) => setValue({ ...value, enabled })} label="Onboarding включён" description="Показывать этот сценарий новым участникам сервера." />
        <label className="mt-4 block"><FieldLabel>Приветствие</FieldLabel><textarea className="min-h-24 w-full resize-y rounded-md border border-border bg-secondary p-3 text-sm" maxLength={1000} value={value.welcome_text || ''} onChange={(event) => setValue({ ...value, welcome_text: event.target.value })} placeholder="Коротко расскажите, что здесь происходит" /></label>
      </Section>

      <Section title="Правила" description="Каждое правило подтверждается одним действием.">
        <div className="space-y-3">{value.rules.map((rule, index) => <div key={rule.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto]"><div className="grid gap-2"><TextInput value={rule.title} onChange={(event) => setValue({ ...value, rules: value.rules.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) })} placeholder="Название правила" /><TextInput value={rule.description} onChange={(event) => setValue({ ...value, rules: value.rules.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) })} placeholder="Пояснение" /></div><Button variant="ghost" size="sm" onClick={() => setValue({ ...value, rules: value.rules.filter((_, itemIndex) => itemIndex !== index) })} aria-label="Удалить правило"><Trash2 className="h-4 w-4" /></Button></div>)}</div>
        <Button variant="outline" className="mt-3" onClick={() => setValue({ ...value, rules: [...value.rules, { id: id(), title: '', description: '' }] })}><Plus className="mr-2 h-4 w-4" />Добавить правило</Button>
      </Section>

      <Section title="Каналы по умолчанию" description="Эти каналы получит каждый участник после завершения onboarding.">
        <div className="grid gap-2 sm:grid-cols-2">{textChannels.map((channel) => <label key={channel.id} className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 text-sm"><input type="checkbox" checked={value.default_channel_ids.includes(channel.id)} onChange={(event) => setValue({ ...value, default_channel_ids: event.target.checked ? [...value.default_channel_ids, channel.id] : value.default_channel_ids.filter((item) => item !== channel.id) })} /><span>#{channel.name}</span></label>)}</div>
      </Section>

      <Section title="Вопросы и интересы" description="Ответы открывают выбранные каналы и делают первый экран короче.">
        <div className="space-y-4">{value.prompts.map((prompt, promptIndex) => <div key={prompt.id} className="rounded-lg border border-border p-4"><div className="flex gap-2"><TextInput value={prompt.title} onChange={(event) => setValue({ ...value, prompts: value.prompts.map((item, index) => index === promptIndex ? { ...item, title: event.target.value } : item) })} placeholder="Например: Что вам интересно?" /><Button variant="ghost" size="sm" onClick={() => setValue({ ...value, prompts: value.prompts.filter((_, index) => index !== promptIndex) })} aria-label="Удалить вопрос"><Trash2 className="h-4 w-4" /></Button></div><div className="mt-3 space-y-2">{prompt.options.map((option, optionIndex) => <div key={option.id} className="rounded-md bg-secondary/60 p-3"><div className="flex gap-2"><TextInput value={option.label} onChange={(event) => setValue({ ...value, prompts: value.prompts.map((item, index) => index === promptIndex ? { ...item, options: item.options.map((entry, entryIndex) => entryIndex === optionIndex ? { ...entry, label: event.target.value } : entry) } : item) })} placeholder="Вариант ответа" /><Button variant="ghost" size="sm" onClick={() => setValue({ ...value, prompts: value.prompts.map((item, index) => index === promptIndex ? { ...item, options: item.options.filter((_, entryIndex) => entryIndex !== optionIndex) } : item) })}><Trash2 className="h-4 w-4" /></Button></div><div className="mt-2 flex flex-wrap gap-2">{textChannels.map((channel) => <label key={channel.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={option.channel_ids.includes(channel.id)} onChange={(event) => setValue({ ...value, prompts: value.prompts.map((item, index) => index === promptIndex ? { ...item, options: item.options.map((entry, entryIndex) => entryIndex === optionIndex ? { ...entry, channel_ids: event.target.checked ? [...entry.channel_ids, channel.id] : entry.channel_ids.filter((value) => value !== channel.id) } : entry) } : item) })} />#{channel.name}</label>)}</div></div>)}</div><Button variant="ghost" className="mt-2" onClick={() => setValue({ ...value, prompts: value.prompts.map((item, index) => index === promptIndex ? { ...item, options: [...item.options, { id: id(), label: '', description: '', channel_ids: [] }] } : item) })}><Plus className="mr-2 h-4 w-4" />Вариант</Button></div>)}</div>
        <Button variant="outline" className="mt-3" onClick={() => setValue({ ...value, prompts: [...value.prompts, { id: id(), title: '', required: false, multiple: true, options: [{ id: id(), label: '', description: '', channel_ids: [] }] }] })}><Plus className="mr-2 h-4 w-4" />Добавить вопрос</Button>
      </Section>
    </TabShell>
  )
}
