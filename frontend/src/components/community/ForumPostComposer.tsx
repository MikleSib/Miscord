'use client'

import { FileText, Loader2, Paperclip, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '../../lib/utils'
import { communityApi } from '../../services/communityApi'
import uploadService from '../../services/uploadService'
import type { Forum, ForumPostSummary } from '../../types/community'
import { Modal } from '../ui/modal'

interface ForumPostComposerProps {
  forum: Forum
  open: boolean
  canUseModeratedTags: boolean
  onClose: () => void
  onCreated: (post: ForumPostSummary) => void
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

export function ForumPostComposer({ forum, open, canUseModeratedTags, onClose, onCreated }: ForumPostComposerProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tagIds, setTagIds] = useState<number[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle('')
    setContent('')
    setTagIds([])
    setFiles([])
    setError('')
  }, [open])

  const missingTag = forum.settings.require_tag && tagIds.length === 0
  const canSubmit = Boolean(title.trim() && content.trim() && !missingTag && !loading)
  const selectedNames = useMemo(
    () => forum.tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => tag.name),
    [forum.tags, tagIds],
  )

  const addFiles = (selected: File[]) => {
    setFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
      const unique = selected.filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`))
      return [...current, ...unique].slice(0, 10)
    })
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError('')
    const uploadedIds: string[] = []
    try {
      for (const uploaded of await uploadService.uploadFiles(files)) uploadedIds.push(uploaded.upload_id)
      const post = await communityApi.createForumPost(forum.id, {
        title: title.trim(),
        content: content.trim(),
        tag_ids: tagIds,
        attachment_upload_ids: uploadedIds,
      })
      onCreated(post)
      onClose()
    } catch (reason: any) {
      await Promise.allSettled(uploadedIds.map((uploadId) => uploadService.deleteUpload(uploadId)))
      setError(reason?.response?.data?.detail || 'Не удалось опубликовать запись. Проверьте данные и попробуйте снова.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} disableClose={loading} title="Новая публикация" contentClassName="max-h-[min(92dvh,780px)] max-w-2xl overflow-y-auto bg-surface-raised">
      <form onSubmit={submit}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface-raised px-5 py-4">
          <div>
            <h2 className="text-xl font-bold">Новая публикация</h2>
            <p className="mt-1 text-sm text-text-quiet">Начните отдельное обсуждение в «{forum.name}».</p>
          </div>
          <button type="button" onClick={onClose} disabled={loading} aria-label="Закрыть" className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-text-quiet hover:bg-surface hover:text-foreground disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-5 px-5 py-4">
          {forum.settings.guidelines && (
            <aside className="rounded-lg bg-canvas-deep px-4 py-3 text-sm leading-6 text-text-body">
              <strong className="block text-foreground">Перед публикацией</strong>
              <span className="whitespace-pre-line">{forum.settings.guidelines}</span>
            </aside>
          )}
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-red-300">{error}</p>}

          <label htmlFor="forum-post-title" className="block text-sm font-semibold text-text-body">
            Заголовок
            <input
              id="forum-post-title"
              autoFocus
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Коротко опишите тему"
              className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3 font-normal text-foreground outline-none placeholder:text-text-quiet focus:ring-2 focus:ring-primary"
            />
            <span className="mt-1 block text-right text-xs font-normal text-text-quiet">{title.length}/100</span>
          </label>

          {forum.tags.length > 0 && (
            <fieldset>
              <legend className="text-sm font-semibold text-text-body">Теги {forum.settings.require_tag && <span className="text-[#f0b232]">· обязательно</span>}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {forum.tags.map((tag) => {
                  const selected = tagIds.includes(tag.id)
                  const disabled = tag.moderated && !canUseModeratedTags
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={disabled}
                      title={disabled ? 'Этот тег назначает только модератор' : undefined}
                      onClick={() => setTagIds((ids) => selected ? ids.filter((id) => id !== tag.id) : [...ids, tag.id].slice(0, 5))}
                      className={cn('min-h-9 rounded-full border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45', selected ? 'border-primary bg-primary/15 text-[#c4c8ff]' : 'border-border bg-surface text-text-body hover:border-border-control')}
                    >
                      {tag.emoji ? `${tag.emoji} ` : ''}{tag.name}
                    </button>
                  )
                })}
              </div>
              <p className={cn('mt-2 text-xs', missingTag ? 'text-[#f0b232]' : 'text-text-quiet')}>
                {selectedNames.length ? `Выбрано: ${selectedNames.join(', ')}` : 'Можно выбрать до 5 тегов.'}
              </p>
            </fieldset>
          )}

          <label htmlFor="forum-post-content" className="block text-sm font-semibold text-text-body">
            Сообщение
            <textarea
              id="forum-post-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={8}
              maxLength={5000}
              placeholder="Добавьте детали, контекст или вопрос для участников"
              className="mt-2 min-h-40 w-full resize-y rounded-md bg-canvas-deep p-3 text-sm font-normal leading-6 text-foreground outline-none placeholder:text-text-quiet focus:ring-2 focus:ring-primary"
            />
            <span className="mt-1 block text-right text-xs font-normal text-text-quiet">{content.length}/5000</span>
          </label>

          {files.length > 0 && (
            <div className="space-y-2" aria-label="Прикреплённые файлы">
              {files.map((file, index) => (
                <div key={`${file.name}:${file.lastModified}`} className="flex items-center gap-3 rounded-lg bg-canvas-deep px-3 py-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-text-quiet" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{file.name}</span><span className="text-xs text-text-quiet">{fileSize(file.size)}</span></span>
                  <button type="button" onClick={() => setFiles((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Убрать ${file.name}`} className="grid h-9 w-9 place-items-center rounded-md text-text-quiet hover:bg-destructive/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}

          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-text-body hover:bg-surface">
            <Paperclip className="h-4 w-4" />Прикрепить файлы <span className="text-xs font-normal text-text-quiet">до 10</span>
            <input type="file" multiple className="sr-only" onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
          </label>
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-surface-raised px-5 py-4">
          <button type="button" onClick={onClose} disabled={loading} className="h-10 rounded-md px-4 text-sm font-medium hover:bg-surface disabled:opacity-40">Отмена</button>
          <button type="submit" disabled={!canSubmit} className="inline-flex h-10 min-w-32 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}{loading ? 'Публикуем…' : 'Опубликовать'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
