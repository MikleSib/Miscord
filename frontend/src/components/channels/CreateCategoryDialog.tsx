'use client'

import { FolderPlus, X } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { Modal } from '../ui/modal'

interface CreateCategoryDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}

export function CreateCategoryDialog({ open, onClose, onSubmit }: CreateCategoryDialogProps) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const resetAndClose = () => {
    setName('')
    setSubmitting(false)
    setError('')
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = name.trim()
    if (!normalized || submitting) return
    setSubmitting(true)
    setError('')
    if (await onSubmit(normalized)) resetAndClose()
    else {
      setError('Не удалось создать категорию. Проверьте права и повторите попытку.')
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="Создать категорию" contentClassName="max-w-md bg-surface-raised">
      <form onSubmit={(event) => void submit(event)} className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <FolderPlus className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-foreground">Создать категорию</h2>
            <p className="mt-1 text-sm leading-5 text-text-quiet">Сгруппируйте текстовые и голосовые каналы в понятный раздел.</p>
          </div>
          <button type="button" onClick={resetAndClose} aria-label="Закрыть" className="grid h-11 w-11 place-items-center rounded-md text-text-quiet hover:bg-surface hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label htmlFor="category-name" className="mt-5 block text-xs font-bold uppercase tracking-wide text-text-quiet">Название категории</label>
        <input
          ref={inputRef}
          id="category-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          autoComplete="off"
          placeholder="Например, Важное"
          className="mt-2 h-11 w-full rounded-md border border-border bg-canvas-deep px-3 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={resetAndClose} disabled={submitting} className="min-h-11 rounded-md px-4 text-sm font-medium hover:bg-surface disabled:opacity-50">Отмена</button>
          <button type="submit" disabled={!name.trim() || submitting} className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50">
            {submitting ? 'Создаём…' : 'Создать категорию'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
