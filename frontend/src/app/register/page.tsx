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
import { authErrorMessage } from '../../lib/authError'
import authService from '../../services/authService'
import { RegisterData, RegistrationChallenge } from '../../types'
import RegisterCodeStep from './RegisterCodeStep'

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
  const [challenge, setChallenge] = useState<RegistrationChallenge | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    let active = true

    const restoreSession = async () => {
      try {
        await authService.restoreSession()
        if (active) router.replace('/app')
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
  }, [clearError, router])

  const updateField = (field: keyof typeof formData, value: string) => {
    setFormData((current) => ({ ...current, [field]: value }))
    setValidationError('')
    if (error) clearError()
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    clearError()

    if (formData.username.trim().length < 2) {
      setValidationError('Имя пользователя должно содержать минимум 2 символа.')
      return
    }
    if (formData.password.length < 8) {
      setValidationError('Пароль должен содержать минимум 8 символов.')
      return
    }
    if (formData.password !== formData.confirmPassword) {
      setValidationError('Пароли не совпадают.')
      return
    }

    const { confirmPassword, ...registerData } = formData
    registerStart()
    try {
      const nextChallenge = await authService.register(registerData as RegisterData)
      if (nextChallenge.registration_complete) {
        registerSuccess()
        setVerified(true)
        window.setTimeout(() => router.replace('/login'), 700)
        return
      }
      setChallenge(nextChallenge)
      registerSuccess()
    } catch (requestError: any) {
      registerFailure(authErrorMessage(requestError, 'Не удалось создать аккаунт.'))
    }
  }

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault()
    if (!challenge?.challenge_id || verificationCode.length !== 6) return
    clearError()
    registerStart()
    try {
      await authService.verifyRegistration(challenge.challenge_id, verificationCode)
      registerSuccess()
      setVerified(true)
      window.setTimeout(() => router.replace('/login'), 1100)
    } catch (requestError: any) {
      registerFailure(authErrorMessage(requestError, 'Не удалось проверить код.'))
    }
  }

  const handleResend = async () => {
    if (!challenge?.challenge_id) return
    clearError()
    registerStart()
    try {
      const nextChallenge = await authService.resendRegistrationCode(challenge.challenge_id)
      setChallenge(nextChallenge)
      setVerificationCode('')
      registerSuccess()
    } catch (requestError: any) {
      registerFailure(authErrorMessage(requestError, 'Не удалось отправить новый код.'))
    }
  }

  const returnToDetails = () => {
    setChallenge(null)
    setVerificationCode('')
    clearError()
  }

  const passwordButton = (visible: boolean, toggle: () => void, label: string) => (
    <button
      type="button"
      className="auth-password-toggle"
      onClick={toggle}
      aria-label={label}
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  )

  return (
    <main className="auth-shell">
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
          <div className="mb-8 md:hidden">
            <div className="auth-brand-mark">
              <img src="/image.svg" alt="Логотип Miscord" className="h-8 w-8 object-contain" />
            </div>
          </div>
          {challenge ? (
            <RegisterCodeStep
              challenge={challenge}
              code={verificationCode}
              error={error}
              loading={isLoading}
              verified={verified}
              onCodeChange={(value) => {
                setVerificationCode(value)
                if (error) clearError()
              }}
              onVerify={handleVerify}
              onResend={handleResend}
              onBack={returnToDetails}
            />
          ) : (
          <>
          <div>
            <p className="text-sm font-semibold text-primary">Новый аккаунт</p>
            <h2 id="register-title" className="mt-2 text-3xl font-bold tracking-[-0.03em]">Присоединяйтесь</h2>
            <p className="mt-2 text-sm text-muted-foreground">Заполните профиль. Остальное можно настроить позже.</p>
          </div>

          {(error || validationError) && (
            <div className="auth-alert auth-alert--error mt-5" role="alert">
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
                    placeholder="Минимум 8 символов"
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
          </>
          )}
        </section>
      </div>
    </main>
  )
}
