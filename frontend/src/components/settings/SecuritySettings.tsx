'use client'

import { useEffect, useState } from 'react'
import { Copy, KeyRound, Laptop, LockKeyhole, Mail, ShieldCheck, Smartphone, Trash2, UserX } from 'lucide-react'

import { Button } from '../ui/button'
import { UserAvatar } from '../ui/user-avatar'
import { accountSecurityService, type AccountSession } from '../../services/accountSecurityService'
import { safetyService, type BlockedUser, type PrivacySettings } from '../../services/safetyService'


function apiError(error: any, fallback: string) {
  const detail = error?.response?.data?.detail
  return typeof detail === 'string' ? detail : detail?.message || fallback
}


export function SecuritySettings() {
  const [sessions, setSessions] = useState<AccountSession[]>([])
  const [privacy, setPrivacy] = useState<PrivacySettings>({
    direct_messages: 'friends_and_servers', friend_requests: 'everyone',
  })
  const [blocks, setBlocks] = useState<BlockedUser[]>([])
  const [twoFactor, setTwoFactor] = useState({ enabled: false, backup_codes_remaining: 0 })
  const [email, setEmail] = useState({ value: '', password: '', challengeId: '', code: '', masked: '' })
  const [totp, setTotp] = useState({ password: '', challengeId: '', secret: '', uri: '', code: '' })
  const [totpManage, setTotpManage] = useState({ password: '', code: '' })
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    const [nextSessions, nextPrivacy, nextBlocks, nextTwoFactor] = await Promise.all([
      accountSecurityService.sessions(), safetyService.privacy(), safetyService.blocks(),
      accountSecurityService.twoFactorStatus(),
    ])
    setSessions(nextSessions)
    setPrivacy(nextPrivacy)
    setBlocks(nextBlocks)
    setTwoFactor(nextTwoFactor)
  }

  useEffect(() => {
    void refresh().catch(() => setFeedback('Не удалось загрузить настройки безопасности.'))
  }, [])

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    setFeedback('')
    try {
      await action()
      setFeedback(success)
    } catch (error) {
      setFeedback(apiError(error, 'Операция не выполнена.'))
    } finally {
      setBusy(false)
    }
  }

  const startEmail = () => run(async () => {
    const result = await accountSecurityService.startEmailChange(email.value, email.password)
    setEmail((current) => ({ ...current, challengeId: result.challenge_id, masked: result.masked_email }))
  }, 'Код отправлен на новую почту.')

  const finishEmail = () => run(async () => {
    await accountSecurityService.finishEmailChange(email.challengeId, email.code)
    window.location.assign('/login')
  }, 'Почта изменена. Войдите снова.')

  const setupTotp = () => run(async () => {
    const result = await accountSecurityService.setupTwoFactor(totp.password)
    setTotp((current) => ({
      ...current, challengeId: result.challenge_id, secret: result.secret, uri: result.otpauth_uri,
    }))
  }, 'Добавьте ключ в приложение-аутентификатор.')

  const enableTotp = () => run(async () => {
    const result = await accountSecurityService.enableTwoFactor(totp.challengeId, totp.code)
    setBackupCodes(result.backup_codes)
    setTwoFactor({ enabled: true, backup_codes_remaining: result.backup_codes.length })
  }, 'Двухфакторная аутентификация включена. Сохраните резервные коды.')

  const regenerateCodes = () => run(async () => {
    const result = await accountSecurityService.regenerateBackupCodes(totpManage.password, totpManage.code)
    setBackupCodes(result.backup_codes)
    setTwoFactor((current) => ({ ...current, backup_codes_remaining: result.backup_codes.length }))
    setTotpManage({ password: '', code: '' })
  }, 'Новые резервные коды созданы. Старые коды больше не действуют.')

  const disableTotp = () => run(async () => {
    await accountSecurityService.disableTwoFactor(totpManage.password, totpManage.code)
    setTwoFactor({ enabled: false, backup_codes_remaining: 0 })
    setBackupCodes([])
    setTotpManage({ password: '', code: '' })
  }, 'Двухфакторная аутентификация выключена.')

  return (
    <div className="mx-auto max-w-3xl pb-20">
      <h2 className="text-xl font-semibold">Безопасность и конфиденциальность</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Управляйте входами, почтой, двухфакторной защитой и тем, кто может связаться с вами.</p>

      {feedback && <div className="mt-5 rounded-md border border-primary/35 bg-primary/10 px-4 py-3 text-sm" role="status">{feedback}</div>}

      <section className="settings-section mt-8">
        <div className="flex items-start gap-3"><Laptop className="mt-0.5 h-5 w-5 text-primary" /><div><h3 className="font-semibold">Активные устройства</h3><p className="text-sm text-muted-foreground">Отзывайте неизвестные или потерянные устройства.</p></div></div>
        <div className="mt-4 divide-y divide-border border-y border-border">
          {sessions.map((session) => (
            <div key={session.id} className="flex min-h-16 items-center gap-3 py-3">
              <Smartphone className="h-4 w-4 flex-none text-muted-foreground" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{session.user_agent || 'Неизвестное устройство'} {session.current && <span className="text-primary">· текущее</span>}</p><p className="text-xs text-muted-foreground">{session.ip_address || 'IP неизвестен'} · {new Date(session.last_seen_at).toLocaleString('ru-RU')}</p></div>
              {!session.current && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { await accountSecurityService.revokeSession(session.id); setSessions((items) => items.filter((item) => item.id !== session.id)) }, 'Сеанс завершён.')} aria-label="Завершить сеанс"><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
        </div>
        <Button variant="outline" className="mt-4" disabled={busy} onClick={() => void run(async () => { await accountSecurityService.revokeOthers(); await refresh() }, 'Все остальные сеансы завершены.')}>Завершить остальные сеансы</Button>
      </section>

      <section className="settings-section mt-10 border-t border-border pt-8">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-primary" /><div><h3 className="font-semibold">Двухфакторная аутентификация</h3><p className="text-sm text-muted-foreground">{twoFactor.enabled ? `Включена · резервных кодов: ${twoFactor.backup_codes_remaining}` : 'Защитите вход кодом из приложения.'}</p></div></div>
        {!twoFactor.enabled && !totp.challengeId && <div className="mt-4 flex flex-col gap-3 sm:flex-row"><input className="h-11 flex-1 rounded-md bg-canvas-deep px-3 text-sm" type="password" value={totp.password} onChange={(event) => setTotp((current) => ({ ...current, password: event.target.value }))} placeholder="Текущий пароль" /><Button disabled={busy || !totp.password} onClick={() => void setupTotp()}><KeyRound className="mr-2 h-4 w-4" />Настроить</Button></div>}
        {!twoFactor.enabled && totp.challengeId && <div className="mt-4 space-y-3 rounded-md bg-secondary p-4"><p className="text-sm">Добавьте ключ вручную в приложение-аутентификатор:</p><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-canvas-deep px-3 py-2 text-sm">{totp.secret}</code><Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(totp.secret)} aria-label="Копировать ключ"><Copy className="h-4 w-4" /></Button></div><input className="h-11 w-full rounded-md bg-canvas-deep px-3 text-sm" inputMode="numeric" value={totp.code} onChange={(event) => setTotp((current) => ({ ...current, code: event.target.value }))} placeholder="6-значный код" /><Button disabled={busy || totp.code.length !== 6} onClick={() => void enableTotp()}>Включить 2FA</Button></div>}
        {twoFactor.enabled && <div className="mt-4 rounded-md border border-border p-4"><div className="grid gap-3 sm:grid-cols-2"><input className="h-11 rounded-md bg-canvas-deep px-3 text-sm" type="password" value={totpManage.password} onChange={(event) => setTotpManage((current) => ({ ...current, password: event.target.value }))} placeholder="Текущий пароль" /><input className="h-11 rounded-md bg-canvas-deep px-3 text-sm" inputMode="numeric" value={totpManage.code} onChange={(event) => setTotpManage((current) => ({ ...current, code: event.target.value }))} placeholder="Код 2FA или резервный код" /></div><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !totpManage.password || !totpManage.code} onClick={() => void regenerateCodes()}>Новые резервные коды</Button><Button variant="destructive" disabled={busy || !totpManage.password || !totpManage.code} onClick={() => void disableTotp()}>Выключить 2FA</Button></div></div>}
        {backupCodes.length > 0 && <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-4"><p className="font-semibold">Сохраните резервные коды сейчас</p><div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">{backupCodes.map((code) => <code key={code}>{code}</code>)}</div></div>}
      </section>

      <section className="settings-section mt-10 border-t border-border pt-8">
        <div className="flex items-start gap-3"><Mail className="mt-0.5 h-5 w-5 text-primary" /><div><h3 className="font-semibold">Смена почты</h3><p className="text-sm text-muted-foreground">Новая почта подтверждается кодом; после смены все сеансы завершатся.</p></div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input className="h-11 rounded-md bg-canvas-deep px-3 text-sm" type="email" value={email.value} onChange={(event) => setEmail((current) => ({ ...current, value: event.target.value }))} placeholder="Новая почта" />
          <input className="h-11 rounded-md bg-canvas-deep px-3 text-sm" type="password" value={email.password} onChange={(event) => setEmail((current) => ({ ...current, password: event.target.value }))} placeholder="Текущий пароль" />
        </div>
        {!email.challengeId ? <Button className="mt-3" disabled={busy || !email.value || !email.password} onClick={() => void startEmail()}><LockKeyhole className="mr-2 h-4 w-4" />Подтвердить новую почту</Button> : <div className="mt-3 flex gap-3"><input className="h-11 min-w-0 flex-1 rounded-md bg-canvas-deep px-3 text-sm" inputMode="numeric" value={email.code} onChange={(event) => setEmail((current) => ({ ...current, code: event.target.value }))} placeholder={`Код для ${email.masked}`} /><Button disabled={busy || email.code.length < 6} onClick={() => void finishEmail()}>Изменить</Button></div>}
      </section>

      <section className="settings-section mt-10 border-t border-border pt-8">
        <div className="flex items-start gap-3"><UserX className="mt-0.5 h-5 w-5 text-primary" /><div><h3 className="font-semibold">Кто может связаться с вами</h3><p className="text-sm text-muted-foreground">Настройки применяются до создания личного диалога и запроса в друзья.</p></div></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Личные сообщения<select className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3" value={privacy.direct_messages} onChange={(event) => setPrivacy((current) => ({ ...current, direct_messages: event.target.value as PrivacySettings['direct_messages'] }))}><option value="everyone">От всех</option><option value="friends_and_servers">Друзья и общие серверы</option><option value="friends">Только друзья</option><option value="nobody">Никто</option></select></label>
          <label className="text-sm font-medium">Запросы в друзья<select className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3" value={privacy.friend_requests} onChange={(event) => setPrivacy((current) => ({ ...current, friend_requests: event.target.value as PrivacySettings['friend_requests'] }))}><option value="everyone">От всех</option><option value="server_members">С общих серверов</option><option value="nobody">Никто</option></select></label>
        </div>
        <Button className="mt-3" disabled={busy} onClick={() => void run(async () => { setPrivacy(await safetyService.updatePrivacy(privacy)) }, 'Настройки конфиденциальности сохранены.')}>Сохранить конфиденциальность</Button>
        {blocks.length > 0 && <div className="mt-6 divide-y divide-border border-y border-border">{blocks.map((user) => <div key={user.id} className="flex items-center gap-3 py-3"><UserAvatar user={user} size={36} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{user.display_name || user.username}</p><p className="text-xs text-muted-foreground">@{user.username}</p></div><Button variant="ghost" size="sm" onClick={() => void run(async () => { await safetyService.unblock(user.id); setBlocks((items) => items.filter((item) => item.id !== user.id)) }, 'Пользователь разблокирован.')}>Разблокировать</Button></div>)}</div>}
      </section>
    </div>
  )
}
