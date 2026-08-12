'use client'

import { FormEvent, Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail, MessagesSquare, ShieldCheck, User } from 'lucide-react'
import { useAuthStore } from '../../store/store'
import { useStore } from '../../lib/store'
import authService from '../../services/authService'

/** Разрешаем только внутренние пути вида `/invite/abc`, без внешних URL. */
function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = safeRedirectPath(searchParams.get('redirect'))
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    loginStart,
    loginSuccess,
    loginFailure,
    clearError,
  } = useAuthStore()
  const { setUser: setStoreUser } = useStore()
  const [formData, setFormData] = useState({ username: '', password: '', otp: '' })
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [reset, setReset] = useState({ email: '', challengeId: '', code: '', password: '' })
  const [resetMessage, setResetMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  useEffect(() => {
    let active = true

    const restoreSession = async () => {
      try {
        const restored = await authService.restoreSession()
        if (!active) return
        useAuthStore.getState().loginSuccess(restored.user, restored.accessToken)
        setStoreUser(restored.user)
        router.replace(redirectTo)
      } catch {
        useAuthStore.getState().logout()
      } finally {
        if (active) setIsCheckingSession(false)
      }
    }

    restoreSession()
    return () => {
      active = false
      clearError()
    }
  }, [clearError, redirectTo, router, setStoreUser])

  useEffect(() => {
    if (isAuthenticated && user) router.replace(redirectTo)
  }, [isAuthenticated, redirectTo, router, user])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    clearError()
    loginStart()

    try {
      const { access_token } = await authService.login(formData)
      useAuthStore.getState().setToken(access_token)
      const currentUser = await authService.getCurrentUser()
      loginSuccess(currentUser, access_token)
      setStoreUser(currentUser)
    } catch (requestError: any) {
      const detail = requestError.response?.data?.detail
      if (requestError.response?.status === 428 && detail?.code === 'two_factor_required') {
        setNeedsTwoFactor(true)
        loginFailure('Введите код приложения-аутентификатора или резервный код.')
      } else {
        loginFailure(typeof detail === 'string' ? detail : detail?.message || 'Не удалось войти. Проверьте логин и пароль.')
      }
    }
  }

  const startReset = async () => {
    setResetMessage('')
    try {
      const result = await authService.startPasswordReset(reset.email)
      setReset((current) => ({ ...current, challengeId: result.challenge_id }))
      setResetMessage(result.message)
    } catch {
      setResetMessage('Не удалось отправить код. Попробуйте позже.')
    }
  }

  const finishReset = async () => {
    setResetMessage('')
    try {
      await authService.finishPasswordReset(reset.challengeId, reset.code, reset.password)
      setResetOpen(false)
      setReset({ email: '', challengeId: '', code: '', password: '' })
      setResetMessage('Пароль изменён. Теперь войдите с новым паролем.')
    } catch (error: any) {
      setResetMessage(error.response?.data?.detail || 'Не удалось изменить пароль.')
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-layout">
        <section className="auth-story" aria-label="О Miscord">
          <div>
            <div className="auth-brand-mark">
              <img src="/image.svg" alt="" className="h-8 w-8 object-contain" />
            </div>
            <p className="mt-7 text-sm font-semibold text-primary">Miscord</p>
            <h1 className="mt-3 max-w-md text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-balance">
              Один разговор. Без лишнего шума.
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">
              Текстовые каналы, голосовые комнаты и демонстрация экрана в одном спокойном рабочем пространстве.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/50">
              <MessagesSquare className="h-4 w-4 text-primary" />
            </span>
            <span>Вернитесь к разговору с того места, где остановились.</span>
          </div>
        </section>

        <section className="auth-card" aria-labelledby="login-title">
          <div className="mb-8 md:hidden">
            <div className="auth-brand-mark">
              <img src="/image.svg" alt="Логотип Miscord" className="h-8 w-8 object-contain" />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-primary">С возвращением</p>
            <h2 id="login-title" className="mt-2 text-3xl font-bold tracking-[-0.03em]">Войдите в Miscord</h2>
            <p className="mt-2 text-sm text-muted-foreground">Продолжите общение в своих каналах.</p>
          </div>

          {error && (
            <div className="mt-6 rounded-lg border border-destructive/35 bg-destructive/10 px-3.5 py-3 text-sm text-red-300" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-7 grid gap-5">
            <label className="auth-field">
              <span className="text-sm font-medium text-foreground">Имя пользователя</span>
              <span className="auth-input-wrap">
                <User className="h-4 w-4 flex-none" aria-hidden="true" />
                <input
                  className="auth-input"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  required
                  value={formData.username}
                  onChange={(event) => setFormData((current) => ({ ...current, username: event.target.value }))}
                  placeholder="Ваш логин"
                />
              </span>
            </label>

            {needsTwoFactor && (
              <label className="auth-field">
                <span className="text-sm font-medium text-foreground">Код двухфакторной аутентификации</span>
                <span className="auth-input-wrap">
                  <ShieldCheck className="h-4 w-4 flex-none" aria-hidden="true" />
                  <input
                    className="auth-input"
                    name="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={formData.otp}
                    onChange={(event) => setFormData((current) => ({ ...current, otp: event.target.value }))}
                    placeholder="6 цифр или резервный код"
                  />
                </span>
              </label>
            )}

            <label className="auth-field">
              <span className="text-sm font-medium text-foreground">Пароль</span>
              <span className="auth-input-wrap">
                <LockKeyhole className="h-4 w-4 flex-none" aria-hidden="true" />
                <input
                  className="auth-input"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={formData.password}
                  onChange={(event) => setFormData((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Введите пароль"
                />
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>

            <button className="auth-submit mt-1" type="submit" disabled={isLoading || isCheckingSession}>
              {isLoading || isCheckingSession ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isCheckingSession ? 'Проверяем сессию' : 'Входим'}
                </>
              ) : (
                <>
                  Войти
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <button
            type="button"
            className="mt-4 text-sm font-semibold text-primary hover:underline hover:underline-offset-4"
            onClick={() => setResetOpen((open) => !open)}
          >
            Забыли пароль?
          </button>

          {resetOpen && (
            <div className="mt-5 border-t border-border pt-5">
              <h3 className="text-base font-semibold">Восстановление доступа</h3>
              <p className="mt-1 text-sm text-muted-foreground">Получите код на подтверждённую почту аккаунта.</p>
              <div className="mt-4 grid gap-3">
                <label className="auth-input-wrap">
                  <Mail className="h-4 w-4 flex-none" />
                  <input className="auth-input" type="email" value={reset.email} onChange={(event) => setReset((current) => ({ ...current, email: event.target.value }))} placeholder="Почта" />
                </label>
                {!reset.challengeId ? (
                  <button type="button" className="auth-submit" onClick={() => void startReset()} disabled={!reset.email}>Отправить код</button>
                ) : (
                  <>
                    <input className="auth-input-wrap h-11 bg-background px-3" inputMode="numeric" value={reset.code} onChange={(event) => setReset((current) => ({ ...current, code: event.target.value }))} placeholder="Код из письма" />
                    <input className="auth-input-wrap h-11 bg-background px-3" type="password" value={reset.password} onChange={(event) => setReset((current) => ({ ...current, password: event.target.value }))} placeholder="Новый пароль" />
                    <button type="button" className="auth-submit" onClick={() => void finishReset()} disabled={reset.code.length < 6 || reset.password.length < 8}>Изменить пароль</button>
                  </>
                )}
                {resetMessage && <p className="text-sm text-muted-foreground" role="status">{resetMessage}</p>}
              </div>
            </div>
          )}

          <p className="mt-6 text-sm text-muted-foreground">
            Нет аккаунта?{' '}
            <Link href="/register" className="font-semibold text-primary hover:underline hover:underline-offset-4">
              Создать аккаунт
            </Link>
          </p>
        </section>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="auth-shell" aria-busy="true" />}>
      <LoginPageContent />
    </Suspense>
  )
}
