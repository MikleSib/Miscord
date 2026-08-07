'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertTriangle, Ban, Loader2, MessagesSquare, Users } from 'lucide-react'

import serverService from '../../../services/serverService'
import authService from '../../../services/authService'
import { resolveMediaUrl } from '../../../lib/mediaUrl'
import { useAuthStore } from '../../../store/store'
import { useStore } from '../../../lib/store'
import { InvitePreview } from '../../../types'

export default function InvitePage() {
  const router = useRouter()
  const params = useParams<{ code: string }>()
  const code = typeof params?.code === 'string' ? params.code : ''

  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isJoining, setIsJoining] = useState(false)
  const [error, setError] = useState('')
  const [iconFailed, setIconFailed] = useState(false)
  const [isAuthorized, setIsAuthorized] = useState(false)

  /** Восстанавливаем сессию: по ссылке могут прийти из браузера без входа. */
  const restoreSession = useCallback(async () => {
    const savedToken =
      typeof window === 'undefined' ? null : localStorage.getItem('access_token')
    if (!savedToken) return false

    try {
      useAuthStore.getState().setToken(savedToken)
      const user = await authService.getCurrentUser()
      useAuthStore.getState().loginSuccess(user, savedToken)
      useStore.getState().setUser(user)
      return true
    } catch {
      localStorage.removeItem('access_token')
      useAuthStore.getState().logout()
      return false
    }
  }, [])

  useEffect(() => {
    if (!code) return

    let active = true

    const init = async () => {
      const authorized = await restoreSession()
      if (!active) return
      setIsAuthorized(authorized)

      try {
        const data = await serverService.getInvitePreview(code)
        if (active) setPreview(data)
        if (active) setIconFailed(false)
      } catch (previewError: any) {
        if (active) {
          setError(
            previewError.response?.data?.detail ||
              'Приглашение не найдено или срок его действия истёк'
          )
        }
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void init()
    return () => {
      active = false
    }
  }, [code, restoreSession])

  const handleJoin = async () => {
    if (!isAuthorized) {
      // После входа вернём пользователя на эту же ссылку
      router.push(`/login?redirect=${encodeURIComponent(`/invite/${code}`)}`)
      return
    }

    setIsJoining(true)
    setError('')
    try {
      await serverService.acceptInvite(code)
      router.replace('/')
    } catch (joinError: any) {
      console.error('Ошибка присоединения по приглашению:', joinError)
      setError(joinError.response?.data?.detail || 'Не удалось присоединиться к серверу')
      setIsJoining(false)
    }
  }

  if (isLoading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          Проверяем приглашение...
        </div>
      </Shell>
    )
  }

  if (!preview) {
    return (
      <Shell>
        <div className="flex flex-col items-center text-center">
          <AlertTriangle className="mb-4 h-10 w-10 text-red-400" />
          <h1 className="mb-2 text-xl font-semibold">Приглашение недействительно</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            {error || 'Ссылка устарела или была отозвана. Попросите новую у того, кто вас пригласил.'}
          </p>
          <button
            type="button"
            onClick={() => router.replace('/')}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            На главную
          </button>
        </div>
      </Shell>
    )
  }

  const blocked = preview.is_banned || preview.is_expired
  const serverIcon = resolveMediaUrl(preview.server_icon)

  return (
    <Shell>
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 h-20 w-20 overflow-hidden rounded-2xl border border-border bg-primary">
          {serverIcon && !iconFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={serverIcon}
              alt={preview.server_name}
              className="h-full w-full object-cover"
              onError={() => setIconFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-primary-foreground">
              {preview.server_name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        <p className="mb-1 text-sm text-muted-foreground">
          {preview.inviter_name
            ? `${preview.inviter_name} приглашает вас на сервер`
            : 'Вас пригласили на сервер'}
        </p>
        <h1 className="mb-3 text-2xl font-semibold">{preview.server_name}</h1>

        {preview.server_description && (
          <p className="mb-4 max-w-sm text-sm text-muted-foreground">
            {preview.server_description}
          </p>
        )}

        <div className="mb-6 flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {preview.online_count} в сети
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            {preview.members_count} участников
          </span>
        </div>

        {error && (
          <div className="mb-4 w-full rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {preview.is_banned ? (
          <div className="flex w-full items-center justify-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <Ban className="h-4 w-4" />
            Вы заблокированы на этом сервере
          </div>
        ) : preview.is_expired ? (
          <div className="w-full rounded-md border border-border bg-secondary px-4 py-3 text-sm text-muted-foreground">
            Срок действия приглашения истёк
          </div>
        ) : preview.is_member ? (
          <button
            type="button"
            onClick={() => router.replace('/')}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Вы уже участник — открыть сервер
          </button>
        ) : (
          <button
            type="button"
            onClick={handleJoin}
            disabled={isJoining || blocked}
            className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {isJoining ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Присоединяемся...
              </>
            ) : isAuthorized ? (
              'Присоединиться к серверу'
            ) : (
              'Войти и присоединиться'
            )}
          </button>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-secondary/40 p-8 shadow-2xl">
        <div className="mb-6 flex items-center justify-center gap-2 text-muted-foreground">
          <MessagesSquare className="h-5 w-5" />
          <span className="text-sm font-semibold">Miscord</span>
        </div>
        {children}
      </div>
    </div>
  )
}
