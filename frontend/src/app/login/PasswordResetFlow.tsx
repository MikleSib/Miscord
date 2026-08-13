'use client'

import { FormEvent, useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Mail } from 'lucide-react'
import { authErrorMessage } from '../../lib/authError'
import authService from '../../services/authService'

interface PasswordResetFlowProps {
  onBack: () => void
  onComplete: (message: string) => void
}

export default function PasswordResetFlow({ onBack, onComplete }: PasswordResetFlowProps) {
  const [email, setEmail] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resendIn])

  const requestCode = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await authService.startPasswordReset(email.trim())
      setChallengeId(result.challenge_id)
      setNotice('Если аккаунт существует, письмо с кодом уже отправлено. Проверьте также папку «Спам».')
      setResendIn(60)
    } catch (requestError) {
      setError(authErrorMessage(requestError, 'Не удалось отправить код. Попробуйте позже.'))
    } finally {
      setBusy(false)
    }
  }

  const finishReset = async (event: FormEvent) => {
    event.preventDefault()
    if (!challengeId || code.length !== 6 || password.length < 8 || busy) return
    setBusy(true)
    setError('')
    try {
      await authService.finishPasswordReset(challengeId, code, password)
      onComplete('Пароль изменён. Войдите с новым паролем.')
    } catch (requestError) {
      setError(authErrorMessage(requestError, 'Не удалось изменить пароль.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-reset">
      <button type="button" className="auth-back" onClick={challengeId ? () => {
        setChallengeId('')
        setCode('')
        setPassword('')
        setError('')
        setNotice('')
      } : onBack}>
        <ArrowLeft aria-hidden="true" />
        {challengeId ? 'Изменить почту' : 'Назад ко входу'}
      </button>

      <span className="auth-reset__icon" aria-hidden="true">
        {challengeId ? <KeyRound /> : <Mail />}
      </span>
      <h2 id="login-title">{challengeId ? 'Введите код из письма' : 'Восстановить пароль'}</h2>
      <p className="auth-reset__lead">
        {challengeId
          ? <>Код отправлен на <strong>{email}</strong>. Он действует 10 минут.</>
          : 'Укажите почту аккаунта — мы отправим шестизначный код для смены пароля.'}
      </p>

      {error && <div className="auth-alert auth-alert--error" role="alert">{error}</div>}
      {notice && <div className="auth-alert auth-alert--info" role="status">{notice}</div>}

      {!challengeId ? (
        <form className="auth-reset__form" onSubmit={requestCode} autoComplete="off">
          <label className="auth-field">
            <span>Электронная почта</span>
            <span className="auth-input-wrap">
              <Mail aria-hidden="true" />
              <input
                className="auth-input"
                type="email"
                name="miscord-recovery-address"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setError('')
                }}
                placeholder="name@example.com"
              />
            </span>
          </label>
          <button className="auth-submit" type="submit" disabled={busy || !email.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Mail />}
            Отправить код
          </button>
        </form>
      ) : (
        <form className="auth-reset__form" onSubmit={finishReset} autoComplete="off">
          <label className="auth-field">
            <span>Код подтверждения</span>
            <span className="auth-input-wrap auth-code-wrap">
              <input
                className="auth-input auth-code-input"
                name="miscord-recovery-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  setError('')
                }}
                placeholder="000000"
                aria-label="Шестизначный код из письма"
              />
            </span>
          </label>
          <label className="auth-field">
            <span>Новый пароль</span>
            <span className="auth-input-wrap">
              <LockKeyhole aria-hidden="true" />
              <input
                className="auth-input"
                type={showPassword ? 'text' : 'password'}
                name="miscord-recovery-new-password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setError('')
                }}
                placeholder="Не менее 8 символов"
              />
              <button type="button" className="auth-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </label>
          <button className="auth-submit" type="submit" disabled={busy || code.length !== 6 || password.length < 8}>
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            Изменить пароль
          </button>
          <button type="button" className="auth-resend" onClick={() => void requestCode()} disabled={busy || resendIn > 0}>
            {resendIn > 0 ? `Отправить повторно через ${resendIn} сек.` : 'Отправить код повторно'}
          </button>
        </form>
      )}
    </div>
  )
}
