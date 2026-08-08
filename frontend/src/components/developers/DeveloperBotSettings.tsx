'use client'

import { useRef, useState, type ReactNode } from 'react'
import {
  Bot,
  Check,
  Copy,
  Image as ImageIcon,
  Link2,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react'

import { Permissions, permissionBitfield } from '../../lib/permissions'
import { Switch } from '../ui/switch'
import type { BotApplication } from '../../types/bot'

type MediaKind = 'avatar' | 'banner'

type PermissionOption = {
  label: string
  value: number
}

const MAX_PERMISSION_VALUE = (BigInt(1) << BigInt(53)) - BigInt(1)

const PERMISSION_GROUPS: Array<{ title: string; options: PermissionOption[] }> = [
  {
    title: 'Основные права',
    options: [
      ['Администратор', Permissions.ADMINISTRATOR],
      ['Просмотр журнала аудита', Permissions.VIEW_AUDIT_LOG],
      ['Управление сервером', Permissions.MANAGE_GUILD],
      ['Управление ролями', Permissions.MANAGE_ROLES],
      ['Управление каналами', Permissions.MANAGE_CHANNELS],
      ['Выгонять участников', Permissions.KICK_MEMBERS],
      ['Блокировать участников', Permissions.BAN_MEMBERS],
      ['Создавать приглашения', Permissions.CREATE_INSTANT_INVITE],
      ['Изменять свой никнейм', Permissions.CHANGE_NICKNAME],
      ['Управлять никнеймами', Permissions.MANAGE_NICKNAMES],
      ['Управлять реакциями', Permissions.MANAGE_GUILD_EXPRESSIONS],
      ['Управлять вебхуками', Permissions.MANAGE_WEBHOOKS],
      ['Просматривать каналы', Permissions.VIEW_CHANNEL],
      ['Управлять событиями', Permissions.MANAGE_EVENTS],
      ['Создавать события', Permissions.CREATE_EVENTS],
      ['Управлять участниками', Permissions.MODERATE_MEMBERS],
      ['Просмотр аналитики сервера', Permissions.VIEW_GUILD_INSIGHTS],
      ['Просмотр аналитики подписок', Permissions.VIEW_CREATOR_MONETIZATION_ANALYTICS],
    ].map(([label, value]) => ({ label: String(label), value: Number(value) })),
  },
  {
    title: 'Права текстовых каналов',
    options: [
      ['Отправлять сообщения', Permissions.SEND_MESSAGES],
      ['Создавать публичные ветки', Permissions.CREATE_PUBLIC_THREADS],
      ['Создавать приватные ветки', Permissions.CREATE_PRIVATE_THREADS],
      ['Отправлять сообщения в ветках', Permissions.SEND_MESSAGES_IN_THREADS],
      ['Отправлять TTS-сообщения', Permissions.SEND_TTS_MESSAGES],
      ['Управлять сообщениями', Permissions.MANAGE_MESSAGES],
      ['Закреплять сообщения', Permissions.PIN_MESSAGES],
      ['Управлять ветками', Permissions.MANAGE_THREADS],
      ['Встраивать ссылки', Permissions.EMBED_LINKS],
      ['Прикреплять файлы', Permissions.ATTACH_FILES],
      ['Читать историю сообщений', Permissions.READ_MESSAGE_HISTORY],
      ['Упоминать всех', Permissions.MENTION_EVERYONE],
      ['Использовать внешние эмодзи', Permissions.USE_EXTERNAL_EMOJIS],
      ['Использовать внешние стикеры', Permissions.USE_EXTERNAL_STICKERS],
      ['Добавлять реакции', Permissions.ADD_REACTIONS],
      ['Использовать команды приложений', Permissions.USE_APPLICATION_COMMANDS],
      ['Использовать внешние приложения', Permissions.USE_EXTERNAL_APPS],
      ['Создавать реакции сервера', Permissions.CREATE_GUILD_EXPRESSIONS],
      ['Создавать опросы', Permissions.SEND_POLLS],
      ['Обходить медленный режим', Permissions.BYPASS_SLOWMODE],
      ['Отправлять голосовые сообщения', Permissions.SEND_VOICE_MESSAGES],
    ].map(([label, value]) => ({ label: String(label), value: Number(value) })),
  },
  {
    title: 'Права голосовых каналов',
    options: [
      ['Подключаться', Permissions.CONNECT],
      ['Говорить', Permissions.SPEAK],
      ['Транслировать видео', Permissions.STREAM],
      ['Отключать микрофон участникам', Permissions.MUTE_MEMBERS],
      ['Отключать звук участникам', Permissions.DEAFEN_MEMBERS],
      ['Перемещать участников', Permissions.MOVE_MEMBERS],
      ['Использовать активацию по голосу', Permissions.USE_VAD],
      ['Приоритетный режим', Permissions.PRIORITY_SPEAKER],
      ['Просить выступить', Permissions.REQUEST_TO_SPEAK],
      ['Использовать встроенные активности', Permissions.USE_EMBEDDED_ACTIVITIES],
      ['Использовать звуковую панель', Permissions.USE_SOUNDBOARD],
      ['Использовать внешние звуки', Permissions.USE_EXTERNAL_SOUNDS],
      ['Устанавливать статус голосового канала', Permissions.SET_VOICE_CHANNEL_STATUS],
    ].map(([label, value]) => ({ label: String(label), value: Number(value) })),
  },
]

const KNOWN_PERMISSION_MASK = PERMISSION_GROUPS
  .flatMap((group) => group.options)
  .reduce((mask, option) => mask | BigInt(option.value), BigInt(0))

function selectedPermission(value: string, permission: number) {
  return (permissionBitfield(value) & BigInt(permission)) === BigInt(permission)
}

function PermissionCheckbox({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex min-h-8 w-full cursor-pointer items-center gap-3 text-left text-sm text-[#dbdee1] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        aria-hidden
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-[4px] border transition-colors ${
          checked
            ? 'border-[#5865f2] bg-[#5865f2] text-white'
            : 'border-[#6d6f78] bg-transparent text-transparent group-hover:border-[#b5bac1]'
        }`}
      >
        <Check className="h-3.5 w-3.5 stroke-[3]" aria-hidden />
      </span>
      <span>{label}</span>
    </button>
  )
}

function SettingsSwitch({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-8 border-b border-[#303238] py-5 last:border-b-0">
      <div className="max-w-4xl">
        <h3 className="text-sm font-semibold text-[#f2f3f5]">{title}</h3>
        <div className="mt-1.5 text-sm leading-5 text-[#b5bac1]">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} variant="brand" aria-label={title} />
    </div>
  )
}

export function DeveloperBotSettings({
  application,
  name,
  onNameChange,
  botPublic,
  onBotPublicChange,
  requireCodeGrant,
  onRequireCodeGrantChange,
  flags,
  onFlagChange,
  permissions,
  onPermissionsChange,
  saving,
  dirty,
  mediaBusy,
  inviteCopied,
  onSave,
  onResetToken,
  onCopyInvite,
  onUploadMedia,
  onDeleteMedia,
}: {
  application: BotApplication
  name: string
  onNameChange: (value: string) => void
  botPublic: boolean
  onBotPublicChange: (value: boolean) => void
  requireCodeGrant: boolean
  onRequireCodeGrantChange: (value: boolean) => void
  flags: number
  onFlagChange: (flag: number, value: boolean) => void
  permissions: string
  onPermissionsChange: (value: string) => void
  saving: boolean
  dirty: boolean
  mediaBusy: MediaKind | null
  inviteCopied: boolean
  onSave: () => void
  onResetToken: () => void
  onCopyInvite: () => void
  onUploadMedia: (kind: MediaKind, file: File) => void
  onDeleteMedia: (kind: MediaKind) => void
}) {
  const avatarInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)
  const [permissionError, setPermissionError] = useState('')
  const [permissionCopied, setPermissionCopied] = useState(false)

  const flagEnabled = (flag: number) => (flags & flag) === flag
  const administratorEnabled = selectedPermission(permissions, Permissions.ADMINISTRATOR)

  const togglePermission = (permission: number, enabled: boolean) => {
    if (permission === Permissions.ADMINISTRATOR) {
      onPermissionsChange(enabled ? String(Permissions.ADMINISTRATOR) : '0')
      setPermissionError('')
      return
    }
    if (administratorEnabled) return
    const current = permissionBitfield(permissions)
    const mask = BigInt(permission)
    onPermissionsChange((enabled ? current | mask : current & ~mask).toString())
    setPermissionError('')
  }

  const updatePermissionCode = (raw: string) => {
    if (!/^\d*$/.test(raw)) return
    if (!raw) {
      onPermissionsChange('0')
      setPermissionError('')
      return
    }
    const parsed = BigInt(raw)
    if (parsed > MAX_PERMISSION_VALUE) {
      setPermissionError('Значение превышает поддерживаемую 53-битную маску.')
      return
    }
    if ((parsed & ~KNOWN_PERMISSION_MASK) !== BigInt(0)) {
      setPermissionError('Код содержит неподдерживаемые биты прав.')
      return
    }
    onPermissionsChange(
      (parsed & BigInt(Permissions.ADMINISTRATOR)) !== BigInt(0)
        ? String(Permissions.ADMINISTRATOR)
        : parsed.toString(),
    )
    setPermissionError('')
  }

  const copyPermissionCode = async () => {
    await navigator.clipboard.writeText(permissions)
    setPermissionCopied(true)
    window.setTimeout(() => setPermissionCopied(false), 1500)
  }

  const acceptFile = (kind: MediaKind, file: File | undefined) => {
    if (!file) return
    onUploadMedia(kind, file)
  }

  return (
    <div className="w-full pb-28">
      <section>
        <h1 className="text-[22px] font-semibold text-[#f2f3f5]">Бот</h1>
        <p className="mt-4 max-w-5xl text-base leading-6 text-[#aeb0b7]">
          Настройте профиль бота Miscord, правила установки и события, которые приложение может получать через Gateway.
        </p>
        <a href="#bot-permissions" className="mt-8 inline-flex text-sm font-medium text-[#00a8fc] hover:underline">
          Перейти к настройке прав
        </a>
      </section>

      <section className="mt-14 grid gap-x-12 gap-y-8 lg:grid-cols-[176px_minmax(0,1fr)]">
        <div>
          <h2 className="text-sm font-semibold">Значок</h2>
          <ul className="mt-3 space-y-1 text-xs leading-4 text-[#8e929b]">
            <li>Рекомендуемый размер: 1024×1024</li>
            <li>Соотношение сторон: 1:1</li>
            <li>PNG, GIF, JPG или WEBP</li>
            <li>Максимум 10 МиБ</li>
          </ul>
        </div>
        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={() => avatarInput.current?.click()}
            className="group relative grid h-36 w-36 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#5865f2] text-4xl font-bold shadow-[0_10px_30px_rgba(0,0,0,.18)]"
            aria-label="Загрузить значок бота"
          >
            {application.avatar_url ? (
              <img src={application.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Bot className="h-16 w-16 text-white" />
            )}
            <span className="absolute inset-0 grid place-items-center bg-black/60 text-sm font-semibold opacity-0 transition-opacity group-hover:opacity-100">
              {mediaBusy === 'avatar' ? 'Загрузка…' : 'Изменить'}
            </span>
          </button>
          {application.avatar_url && (
            <button
              type="button"
              onClick={() => onDeleteMedia('avatar')}
              className="grid h-10 w-10 place-items-center rounded-md text-[#b5bac1] hover:bg-[#2b2d31] hover:text-[#f23f42]"
              aria-label="Удалить значок"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <input
            ref={avatarInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(event) => acceptFile('avatar', event.target.files?.[0])}
          />
        </div>

        <div>
          <h2 className="text-sm font-semibold">Баннер</h2>
          <ul className="mt-3 space-y-1 text-xs leading-4 text-[#8e929b]">
            <li>Рекомендуемый размер: 680×240</li>
            <li>Соотношение сторон: 17:6</li>
            <li>PNG, GIF, JPG или WEBP</li>
            <li>Максимум 10 МиБ</li>
          </ul>
        </div>
        <div
          className="group relative flex h-[150px] w-full max-w-[420px] cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-[#4b4d55] bg-[#111214] text-center hover:border-[#6d6f78]"
          onClick={() => bannerInput.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            acceptFile('banner', event.dataTransfer.files?.[0])
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') bannerInput.current?.click()
          }}
          aria-label="Загрузить баннер бота"
        >
          {application.banner_url ? (
            <img src={application.banner_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          <div className={`relative z-10 grid place-items-center text-sm ${application.banner_url ? 'rounded-md bg-black/70 px-4 py-3' : 'text-[#aeb0b7]'}`}>
            {mediaBusy === 'banner' ? <RefreshCw className="mb-2 h-5 w-5 animate-spin" /> : application.banner_url ? <ImageIcon className="mb-2 h-5 w-5" /> : <UploadCloud className="mb-2 h-5 w-5" />}
            <span>{mediaBusy === 'banner' ? 'Загружаем…' : 'Перетащите или нажмите, чтобы загрузить'}</span>
          </div>
          {application.banner_url && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onDeleteMedia('banner')
              }}
              className="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-md bg-black/70 text-white hover:bg-[#f23f42]"
              aria-label="Удалить баннер"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <input
            ref={bannerInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(event) => acceptFile('banner', event.target.files?.[0])}
          />
        </div>
      </section>

      <section className="mt-9">
        <label className="mb-2 block text-sm font-semibold" htmlFor="bot-display-name">Имя бота</label>
        <div className="flex min-h-11 overflow-hidden rounded-[5px] border border-[#4e5058] bg-[#1e1f22] focus-within:border-[#00a8fc]">
          <input
            id="bot-display-name"
            value={name}
            maxLength={80}
            onChange={(event) => onNameChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
          />
          <span className="grid min-w-[100px] place-items-center border-l border-[#35373c] px-4 font-mono text-sm font-semibold text-[#7d8089]">
            #{application.client_id.slice(-4)}
          </span>
        </div>
      </section>

      <section className="mt-7 border-b border-[#303238] pb-7">
        <h2 className="text-sm font-semibold">Токен</h2>
        <p className="mt-1.5 text-xs leading-5 text-[#b5bac1]">
          В целях безопасности токен показывается только один раз. Если доступ потерян, создайте новый — старый сразу перестанет работать.
        </p>
        <button
          type="button"
          disabled={saving || application.status !== 'active'}
          onClick={onResetToken}
          className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-[5px] bg-[#5865f2] px-3.5 text-sm font-semibold hover:bg-[#4752c4] disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          Сбросить токен
        </button>
      </section>

      <section className="mt-7">
        <h2 className="text-xl font-semibold">Поток авторизации</h2>
        <p className="mt-1 text-sm text-[#b5bac1]">Определяет, кто и каким способом может устанавливать этого бота.</p>
        <div className="mt-3">
          <SettingsSwitch
            title="Публичный бот"
            description="Публичного бота могут устанавливать все пользователи с правом управления сервером. Если выключить настройку, установка будет доступна только владельцу приложения."
            checked={botPublic}
            onChange={onBotPublicChange}
          />
          <SettingsSwitch
            title="Требуется код доступа OAuth2"
            description="Бот подключится только после завершения полного authorization code flow и получения сервером access token."
            checked={requireCodeGrant}
            onChange={onRequireCodeGrantChange}
          />
        </div>
      </section>

      <section className="mt-7">
        <h2 className="text-xl font-semibold">Привилегированные намерения Gateway</h2>
        <p className="mt-2 max-w-5xl text-sm leading-5 text-[#b5bac1]">
          Включайте только события, которые действительно нужны приложению. Gateway отклонит подключение, если бот запросит выключенное привилегированное намерение.
        </p>
        <div className="mt-5">
          <SettingsSwitch
            title="Намерение присутствия"
            description="Разрешает события об изменении статуса и активности участников."
            checked={flagEnabled(1 << 12)}
            onChange={(value) => onFlagChange(1 << 12, value)}
          />
          <SettingsSwitch
            title="Намерение участников сервера"
            description="Разрешает получать список участников, входы, выходы и обновления профилей на сервере."
            checked={flagEnabled(1 << 14)}
            onChange={(value) => onFlagChange(1 << 14, value)}
          />
          <SettingsSwitch
            title="Намерение содержимого сообщений"
            description="Разрешает получать текст, вложения и компоненты большинства сообщений, доступных боту."
            checked={flagEnabled(1 << 18)}
            onChange={(value) => onFlagChange(1 << 18, value)}
          />
        </div>
      </section>

      <section id="bot-permissions" className="mt-8 scroll-mt-20 rounded-md border border-[#50525b] bg-[#313238] px-5 py-5 md:px-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#b5bac1]" />
          <div>
            <h2 className="text-lg font-semibold">Права для бота</h2>
            <p className="mt-1 text-sm leading-5 text-[#d1d3d7]">
              Выберите операции, которые нужны боту. Miscord рассчитает точное целочисленное значение и использует его в ссылке приглашения.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-sm font-semibold text-[#f2f3f5]">{group.title}</h3>
              <div className="grid gap-0.5">
                {group.options.map((option) => (
                  <PermissionCheckbox
                    key={option.label}
                    label={option.label}
                    checked={selectedPermission(permissions, option.value)}
                    disabled={administratorEnabled && option.value !== Permissions.ADMINISTRATOR}
                    onChange={(checked) => togglePermission(option.value, checked)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-7">
          <label htmlFor="permission-code" className="mb-2 block text-sm font-semibold">Числовой код прав</label>
          <div className="flex min-h-11 overflow-hidden rounded-[5px] border border-[#4e5058] bg-[#232428] focus-within:border-[#00a8fc]">
            <input
              id="permission-code"
              inputMode="numeric"
              value={permissions}
              onChange={(event) => updatePermissionCode(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-[#b5bac1] outline-none"
              aria-invalid={Boolean(permissionError)}
            />
            <button
              type="button"
              onClick={copyPermissionCode}
              className="grid w-11 place-items-center border-l border-[#3f4148] bg-[#5865f2] hover:bg-[#4752c4]"
              aria-label="Копировать числовой код прав"
            >
              {permissionCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          {permissionError && <p className="mt-2 text-xs text-[#fa777c]">{permissionError}</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onCopyInvite}
              className="inline-flex min-h-10 items-center gap-2 rounded-[5px] bg-[#5865f2] px-4 text-sm font-semibold hover:bg-[#4752c4]"
            >
              {inviteCopied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {inviteCopied ? 'Ссылка приглашения скопирована' : 'Копировать ссылку приглашения'}
            </button>
          </div>
        </div>
      </section>

      <div className={`fixed inset-x-0 bottom-0 z-30 border-t border-[#3f4148] bg-[#1e1f22]/95 px-5 py-3 backdrop-blur transition-transform ${dirty ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="mx-auto flex max-w-[1380px] items-center justify-between gap-4">
          <p className="text-sm text-[#dbdee1]">У вас есть несохранённые изменения.</p>
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={onSave}
            className="inline-flex min-h-10 items-center gap-2 rounded-[5px] bg-[#23a55a] px-4 text-sm font-semibold hover:bg-[#1a8f4b] disabled:opacity-50"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить изменения
          </button>
        </div>
      </div>
    </div>
  )
}
