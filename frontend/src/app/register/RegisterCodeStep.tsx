'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, MailCheck, RotateCcw } from 'lucide-react'
import { RegistrationChallenge } from '../../types'

interface RegisterCodeStepProps {
  challenge: RegistrationChallenge
  code: string
  error: string | null
  loading: boolean
  verified: boolean
  onCodeChange: (value: string) => void
  onVerify: (event: FormEvent) => void
  onResend: () => void
  onBack: () => void
}

export default function RegisterCodeStep({
  challenge,
  code,
  error,
  loading,
  verified,
  onCodeChange,
  onVerify,
  onResend,
  onBack,
}: RegisterCodeStepProps) {
  const resendDeadline = useMemo(
    () => Date.now() + challenge.resend_in * 1000,
    [challenge],
  )
  const expiryDeadline = useMemo(
    () => Date.now() + challenge.expires_in * 1000,
    [challenge],
  )
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const resendSeconds = Math.max(0, Math.ceil((resendDeadline - now) / 1000))
  const expirySeconds = Math.max(0, Math.ceil((expiryDeadline - now) / 1000))
  const expiryMinutes = Math.floor(expirySeconds / 60)
  const expiryRemainder = String(expirySeconds % 60).padStart(2, '0')

  if (verified) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center text-center" role="status">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
          <CheckCircle2 className="h-8 w-8" />
        </span>
        <h2 id="register-title" className="mt-5 text-2xl font-bold">Почта подтверждена</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Аккаунт создан. Сейчас откроем страницу входа.
        </p>
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Изменить данные
      </button>
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <MailCheck className="h-6 w-6" />
      </div>
      <p className="mt-5 text-sm font-semibold text-primary">Проверка почты</p>
      <h2 id="register-title" className="mt-2 text-3xl font-bold tracking-[-0.03em]">Введите код из письма</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Мы отправили шестизначный код на <span className="font-semibold text-foreground">{challenge.email_hint}</span>.
      </p>

      {error && (
        <div className="mt-5 rounded-lg border border-destructive/35 bg-destructive/10 px-3.5 py-3 text-sm text-red-300" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={onVerify} className="mt-6 grid gap-4">
        <label className="auth-field">
          <span className="text-sm font-medium">Код подтверждения</span>
          <span className="auth-input-wrap px-4">
            <KeyRound className="h-4 w-4 flex-none text-muted-foreground" />
            <input
              autoFocus
              className="auth-input text-center text-2xl font-bold tracking-[0.42em] tabular-nums"
              name="verification-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-describedby="code-expiry"
              placeholder="000000"
            />
          </span>
        </label>
        <p id="code-expiry" className="text-xs text-muted-foreground">
          Код действует ещё {expiryMinutes}:{expiryRemainder}.
        </p>
        <button className="auth-submit" type="submit" disabled={loading || code.length !== 6 || expirySeconds === 0}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Подтвердить и создать аккаунт
        </button>
      </form>

      <button
        type="button"
        onClick={onResend}
        disabled={loading || resendSeconds > 0}
        className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:text-muted-foreground"
      >
        <RotateCcw className="h-4 w-4" />
        {resendSeconds > 0 ? `Отправить снова через ${resendSeconds} сек.` : 'Отправить новый код'}
      </button>
    </div>
  )
}
