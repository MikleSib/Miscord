'use client'

import { useMemo, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'

import type { Message } from '../types'
import botService from '../services/botService'
import { cn } from '../lib/utils'

type DiscordComponent = {
  type?: number
  style?: number
  custom_id?: string
  label?: string
  url?: string
  disabled?: boolean
  placeholder?: string
  min_values?: number
  max_values?: number
  emoji?: { id?: string | null; name?: string | null; animated?: boolean }
  options?: Array<{
    label?: string
    value?: string
    description?: string
    emoji?: { id?: string | null; name?: string | null }
    default?: boolean
  }>
  components?: DiscordComponent[]
}

const buttonStyles: Record<number, string> = {
  1: 'bg-[#5865f2] text-white hover:bg-[#4752c4]',
  2: 'bg-[#4e5058] text-white hover:bg-[#5d6069]',
  3: 'bg-[#248046] text-white hover:bg-[#1a6334]',
  4: 'bg-[#da373c] text-white hover:bg-[#a1282d]',
  5: 'bg-[#4e5058] text-white hover:bg-[#5d6069]',
}

function Emoji({ emoji }: { emoji?: DiscordComponent['emoji'] }) {
  if (!emoji?.name) return null
  return <span aria-hidden>{emoji.name}</span>
}

export function ApplicationMessageComponents({ message }: { message: Message }) {
  const rows = useMemo(() => (message.components || []) as DiscordComponent[], [message.components])
  const [pending, setPending] = useState<string | null>(null)
  const [completed, setCompleted] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  if (!rows.length || !message.channelId) return null

  const interact = async (component: DiscordComponent, values: string[] = []) => {
    const customId = component.custom_id
    if (!customId || !message.channelId || pending) return
    setPending(customId)
    setError(null)
    try {
      await botService.interactComponent(message.channelId, {
        message_id: message.id,
        custom_id: customId,
        component_type: component.type || 2,
        values,
      })
      setCompleted((current) => new Set(current).add(customId))
    } catch (requestError) {
      const detail = (requestError as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Приложение не ответило. Попробуйте ещё раз.')
    } finally {
      setPending(null)
    }
  }

  const renderComponent = (component: DiscordComponent, index: number) => {
    const type = Number(component.type || 0)
    const key = component.custom_id || component.url || `${type}-${index}`
    const disabled = Boolean(component.disabled || pending || (component.custom_id && completed.has(component.custom_id)))

    if (type === 2) {
      const content = <><Emoji emoji={component.emoji} />{component.label || (!component.emoji ? 'Button' : null)}{pending === component.custom_id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{component.style === 5 ? <ExternalLink className="h-3.5 w-3.5" /> : null}</>
      if (component.style === 5 && component.url) {
        return <a key={key} href={component.url} target="_blank" rel="noreferrer" className={cn('inline-flex min-h-8 items-center gap-2 rounded px-4 text-sm font-medium transition', buttonStyles[5])}>{content}</a>
      }
      return <button key={key} type="button" disabled={disabled} onClick={() => void interact(component)} className={cn('inline-flex min-h-8 items-center gap-2 rounded px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50', buttonStyles[component.style || 2] || buttonStyles[2])}>{content}</button>
    }

    if ([3, 5, 6, 7, 8].includes(type)) {
      const options = component.options || []
      const multiple = (component.max_values || 1) > 1
      return (
        <select
          key={key}
          multiple={multiple}
          disabled={disabled}
          defaultValue={multiple ? options.filter((option) => option.default).map((option) => option.value || '') : options.find((option) => option.default)?.value || ''}
          onChange={(event) => {
            const values = Array.from(event.currentTarget.selectedOptions).map((option) => option.value).filter(Boolean)
            if (values.length >= (component.min_values || 1)) void interact(component, values)
          }}
          className="min-h-10 min-w-52 max-w-full rounded border border-white/10 bg-[#1e1f22] px-3 text-sm text-[#dbdee1] outline-none focus:border-[#5865f2] disabled:opacity-50"
          aria-label={component.placeholder || 'Выберите значение'}
        >
          {!multiple && <option value="" disabled>{component.placeholder || 'Выберите значение'}</option>}
          {options.map((option) => <option key={option.value} value={option.value}>{option.emoji?.name ? `${option.emoji.name} ` : ''}{option.label || option.value}{option.description ? ` — ${option.description}` : ''}</option>)}
        </select>
      )
    }

    return null
  }

  return (
    <div className="mt-2 space-y-2">
      {rows.map((row, rowIndex) => {
        const children = row.type === 1 ? row.components || [] : [row]
        return <div key={row.custom_id || `row-${rowIndex}`} className="flex flex-wrap items-center gap-2">{children.map(renderComponent)}</div>
      })}
      {error && <p className="text-xs text-[#ffb8ba]" role="alert">{error}</p>}
    </div>
  )
}
