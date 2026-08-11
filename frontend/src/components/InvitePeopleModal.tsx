'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Loader2, X } from 'lucide-react'

import { getOrCreateDefaultInvite } from '../services/defaultInviteService'
import { Server } from '../types'
import { useModalFocusTrap } from '../hooks/useModalFocusTrap'

interface InvitePeopleModalProps {
  isOpen: boolean
  onClose: () => void
  server: Server
}

const MODAL_Z_INDEX = 120

export function InvitePeopleModal({ isOpen, onClose, server }: InvitePeopleModalProps) {
  const [mounted, setMounted] = useState(false)
  const [link, setLink] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const dialogRef = useModalFocusTrap<HTMLDivElement>(isOpen, onClose)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    const createInvite = async () => {
      setIsLoading(true)
      setError('')
      setCopied(false)
      setLink('')
      try {
        const invite = await getOrCreateDefaultInvite(server.id)
        if (cancelled) return
        const nextLink =
          typeof window === 'undefined'
            ? `/invite/${invite.code}`
            : `${window.location.origin}/invite/${invite.code}`
        setLink(nextLink)
      } catch (createError: any) {
        if (cancelled) return
        console.error('Ошибка создания приглашения:', createError)
        setError(createError.response?.data?.detail || 'Не удалось создать приглашение')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void createInvite()

    return () => {
      cancelled = true
    }
  }, [isOpen, server.id])

  const handleCopy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = link
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  if (!mounted || !isOpen) return null

  return createPortal(
    <div
      className="miscord-responsive-modal fixed inset-0 flex items-center justify-center bg-black/70 p-4"
      style={{ zIndex: MODAL_Z_INDEX }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-people-title"
        className="miscord-responsive-modal-card w-full max-w-md overflow-hidden rounded-lg bg-surface-raised shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between px-4 pb-2 pt-4">
          <div className="min-w-0 pr-3">
            <h2 id="invite-people-title" className="text-xl font-bold text-white">
              Пригласить друзей на {server.name}
            </h2>
            <p className="mt-1 text-sm text-[#b5bac1]">
              Отправьте ссылку другу — он сможет присоединиться к серверу.
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className="rounded p-1 text-[#b5bac1] transition hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 pb-5 pt-3">
          {error && (
            <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#b5bac1]">
            Ссылка-приглашение
          </p>

          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-md bg-[#1e1f22] px-3 py-2.5">
              {isLoading ? (
                <span className="inline-flex items-center gap-2 text-sm text-[#949ba4]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Создаём ссылку…
                </span>
              ) : (
                <span className="truncate text-sm text-[#dbdee1]">{link || '—'}</span>
              )}
            </div>
            <button
              type="button"
              disabled={!link || isLoading}
              onClick={() => void handleCopy()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#5865f2] px-4 text-sm font-semibold text-white transition hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Копировать
                </>
              )}
            </button>
          </div>

          <p className="mt-3 text-xs text-[#949ba4]">Ссылка действует 7 дней.</p>
        </div>
      </div>
    </div>,
    document.body
  )
}
