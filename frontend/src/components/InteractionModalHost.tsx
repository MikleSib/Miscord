'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'

import botService from '../services/botService'
import websocketService from '../services/websocketService'

type ModalTextInput = {
  type?: number
  custom_id?: string
  label?: string
  style?: number
  min_length?: number
  max_length?: number
  required?: boolean
  value?: string
  placeholder?: string
}

type ModalComponent = ModalTextInput & { components?: ModalTextInput[] }

type InteractionModal = {
  interaction_id: string
  application_id: string
  channel_id: number
  custom_id: string
  title?: string
  components?: ModalComponent[]
}

function textInputs(modal: InteractionModal | null): ModalTextInput[] {
  if (!modal) return []
  return (modal.components || []).flatMap((component) =>
    Number(component.type) === 1 ? component.components || [] : [component],
  ).filter((component) => Number(component.type) === 4 && Boolean(component.custom_id))
}

export function InteractionModalHost() {
  const [modal, setModal] = useState<InteractionModal | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputs = useMemo(() => textInputs(modal), [modal])

  useEffect(() => {
    const handleModal = (payload: { data?: InteractionModal } | InteractionModal) => {
      const next: InteractionModal | null = (payload as { data?: InteractionModal }).data
        || (payload as InteractionModal)
        || null
      if (!next?.interaction_id || !next.custom_id || !Number(next.channel_id)) return
      const initial: Record<string, string> = {}
      for (const input of textInputs(next)) {
        if (input.custom_id) initial[input.custom_id] = input.value || ''
      }
      setValues(initial)
      setError(null)
      setModal(next)
    }
    websocketService.on('interaction_modal', handleModal)
    return () => websocketService.off('interaction_modal', handleModal)
  }, [])

  useEffect(() => {
    if (!modal) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) setModal(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [modal, pending])

  if (!modal) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await botService.submitModal(Number(modal.channel_id), {
        source_interaction_id: modal.interaction_id,
        custom_id: modal.custom_id,
        components: inputs.map((input) => ({
          type: 1,
          components: [{ type: 4, custom_id: input.custom_id, value: values[input.custom_id || ''] || '' }],
        })),
      })
      if (result.status === 'failed' || result.status === 'offline') {
        throw new Error('Приложение не смогло обработать форму.')
      }
      setModal(null)
    } catch (requestError) {
      const detail = (requestError as { response?: { data?: { detail?: string } }; message?: string }).response?.data?.detail
      setError(typeof detail === 'string' ? detail : (requestError as Error).message || 'Не удалось отправить форму.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4" role="presentation">
      <form
        onSubmit={submit}
        className="w-full max-w-[440px] rounded-xl border border-white/10 bg-[#313338] p-5 text-[#dbdee1] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="interaction-modal-title"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id="interaction-modal-title" className="text-xl font-semibold text-white">
            {modal.title || 'Форма приложения'}
          </h2>
          <button type="button" onClick={() => setModal(null)} disabled={pending} className="rounded p-1 text-[#b5bac1] hover:bg-white/10 hover:text-white disabled:opacity-50" aria-label="Закрыть">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {inputs.map((input) => {
            const inputId = input.custom_id || ''
            const common = {
              id: `modal-${inputId}`,
              value: values[inputId] || '',
              minLength: Math.max(0, input.min_length || 0),
              maxLength: Math.min(4000, Math.max(1, input.max_length || 4000)),
              required: input.required !== false,
              placeholder: input.placeholder,
              disabled: pending,
              onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((current) => ({ ...current, [inputId]: event.target.value })),
              className: 'w-full rounded border border-[#1e1f22] bg-[#1e1f22] px-3 py-2 text-sm text-[#dbdee1] outline-none placeholder:text-[#6d6f78] focus:border-[#5865f2] disabled:opacity-60',
            }
            return (
              <label key={inputId} htmlFor={common.id} className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#b5bac1]">
                  {input.label || inputId}{input.required !== false ? <span className="ml-1 text-[#f23f42]">*</span> : null}
                </span>
                {Number(input.style) === 2
                  ? <textarea {...common} rows={4} />
                  : <input {...common} type="text" />}
              </label>
            )
          })}
        </div>

        {error ? <p className="mt-4 text-sm text-[#ffb8ba]" role="alert">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={() => setModal(null)} disabled={pending} className="rounded px-4 py-2 text-sm font-medium hover:underline disabled:opacity-50">Отмена</button>
          <button type="submit" disabled={pending || inputs.length === 0} className="inline-flex min-w-24 items-center justify-center gap-2 rounded bg-[#5865f2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752c4] disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Отправить
          </button>
        </div>
      </form>
    </div>
  )
}
