'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  AtSign,
  Badge,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  Radio,
} from 'lucide-react'
import { useAuthStore } from '../../store/store'
import authService from '../../services/authService'
import { RegisterData } from '../../types'

export default function RegisterPage() {
  const router = useRouter()
  const { isLoading, error, registerStart, registerSuccess, registerFailure, clearError } = useAuthStore()
  const [formData, setFormData] = useState({
    username: '',
    display_name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [validationError, setValidationError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  useEffect(() => {
    let active = true

    const restoreSession = async () => {
      try {
        const savedToken = localStorage.getItem('access_token')
        if (!savedToken) return
        useAuthStore.getState().setToken(savedToken)
        await authService.getCurrentUser()
        if (active) router.replace('/')
      } catch {
        localStorage.removeItem('access_token')
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
  }, [clearError, router])

  const updateField = (field: keyof typeof formData, value: string) => {
    setFormData((current) => ({ ...current, [field]: value }))
    setValidationError('')
    if (error) clearError()
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    clearError()

    if (formData.username.trim().length < 3) {
      setValidationError('Имя пользователя должно содержать минимум 3 символа.')
      return
    }
    if (formData.password.length < 6) {
      setValidationError('Пароль должен содержать минимум 6 символов.')
      return
    }
    if (formData.password !== formData.confirmPassword) {
      setValidationError('Пароли не совпадают.')
      return
    }

    const { confirmPassword, ...registerData } = formData
    registerStart()
    try {
      await authService.register(registerData as RegisterData)
      registerSuccess()
      router.replace('/login')
    } catch (requestError: any) {
      registerFailure(requestError.response?.data?.detail || requestError.message || 'Не удалось создать аккаунт.')
    }
  }

  const passwordButton = (visible: boolean, toggle: () => void, label: string) => (
    <button
      type="button"
      className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
      onClick={toggle}
      aria-label={label}
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  )

  return (
    <main className="auth-shell py-5">
      <div className="auth-layout">
        <section className="auth-story" aria-label="О регистрации в Miscord">
          <div>
            <div className="auth-brand-mark">
              <img src="/image.svg" alt="" className="h-8 w-8 object-contain" />
            </div>
            <p className="mt-7 text-sm font-semibold text-primary">Miscord</p>
            <h1 className="mt-3 max-w-md text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-balance">
              Соберите своё пространство для общения.
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">
              Создавайте серверы, открывайте голосовые комнаты и оставайтесь на связи с командой или друзьями.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/50">
              <Radio className="h-4 w-4 text-primary" />
            </span>
            <span>Голосовой канал готов сразу после создания сервера.</span>
          </div>
        </section>

        <section className="auth-card" aria-labelledby="register-title">
          <div>
            <p className="text-sm font-semibold text-primary">Новый аккаунт</p>
            <h2 id="register-title" className="mt-2 text-3xl font-bold tracking-[-0.03em]">Присоединяйтесь</h2>
            <p className="mt-2 text-sm text-muted-foreground">Заполните профиль. Остальное можно настроить позже.</p>
          </div>

          {(error || validationError) && (
            <div className="mt-5 rounded-lg border border-destructive/35 bg-destructive/10 px-3.5 py-3 text-sm text-red-300" role="alert">
              {error || validationError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="auth-field">
                <span className="text-sm font-medium">Имя пользователя</span>
                <span className="auth-input-wrap">
                  <AtSign className="h-4 w-4 flex-none" />
                  <input
                    className="auth-input"
                    name="username"
                    autoComplete="username"
                    required
                    value={formData.username}
                    onChange={(event) => updateField('username', event.target.value)}
                    placeholder="miscord_user"
                  />
                </span>
              </label>

              <label className="auth-field">
                <span className="text-sm font-medium">Отображаемое имя</span>
                <span className="auth-input-wrap">
                  <Badge className="h-4 w-4 flex-none" />
                  <input
                    className="auth-input"
                    name="display_name"
                    autoComplete="name"
                    required
                    value={formData.display_name}
                    onChange={(event) => updateField('display_name', event.target.value)}
                    placeholder="Как вас называть"
                  />
                </span>
              </label>
            </div>

            <label className="auth-field">
              <span className="text-sm font-medium">Email</span>
              <span className="auth-input-wrap">
                <Mail className="h-4 w-4 flex-none" />
                <input
                  className="auth-input"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={formData.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  placeholder="name@example.com"
                />
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="auth-field">
                <span className="text-sm font-medium">Пароль</span>
                <span className="auth-input-wrap">
                  <LockKeyhole className="h-4 w-4 flex-none" />
                  <input
                    className="auth-input"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={formData.password}
                    onChange={(event) => updateField('password', event.target.value)}
                    placeholder="Минимум 6 символов"
                  />
                  {passwordButton(showPassword, () => setShowPassword((visible) => !visible), showPassword ? 'Скрыть пароль' : 'Показать пароль')}
                </span>
              </label>

              <label className="auth-field">
                <span className="text-sm font-medium">Повторите пароль</span>
                <span className="auth-input-wrap">
                  <LockKeyhole className="h-4 w-4 flex-none" />
                  <input
                    className="auth-input"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={formData.confirmPassword}
                    onChange={(event) => updateField('confirmPassword', event.target.value)}
                    placeholder="Ещё раз"
                  />
                  {passwordButton(showConfirmPassword, () => setShowConfirmPassword((visible) => !visible), showConfirmPassword ? 'Скрыть пароль' : 'Показать пароль')}
                </span>
              </label>
            </div>

            <button className="auth-submit mt-1" type="submit" disabled={isLoading || isCheckingSession}>
              {isLoading || isCheckingSession ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isCheckingSession ? 'Проверяем сессию' : 'Создаём аккаунт'}
                </>
              ) : (
                <>
                  Создать аккаунт
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-5 text-sm text-muted-foreground">
            Уже зарегистрированы?{' '}
            <Link href="/login" className="font-semibold text-primary hover:underline hover:underline-offset-4">
              Войти
            </Link>
          </p>
        </section>
      </div>
    </main>
  )
}