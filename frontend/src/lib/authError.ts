type ValidationIssue = {
  loc?: Array<string | number>
  msg?: string
  type?: string
  ctx?: Record<string, unknown>
}

type AuthRequestError = {
  code?: string
  message?: string
  response?: {
    status?: number
    data?: { detail?: unknown }
  }
}

const KNOWN_MESSAGES: Record<string, string> = {
  'incorrect username or password': 'Неверный логин или пароль.',
  'username or email already registered': 'Аккаунт с такой почтой или логином уже существует.',
  'email verification is not enabled': 'Подтверждение почты временно недоступно.',
  'refresh session is invalid or expired': 'Сессия истекла. Войдите снова.',
  'session not found': 'Сессия не найдена. Войдите снова.',
  'network error': 'Нет соединения с сервером. Проверьте интернет и попробуйте снова.',
  'failed to fetch': 'Нет соединения с сервером. Проверьте интернет и попробуйте снова.',
}

const FIELD_NAMES: Record<string, string> = {
  username: 'Логин',
  display_name: 'Отображаемое имя',
  email: 'Почта',
  password: 'Пароль',
  new_password: 'Новый пароль',
  code: 'Код подтверждения',
}

function hasRussianText(value: string): boolean {
  return /[А-Яа-яЁё]/.test(value)
}

function translateString(value: string): string | null {
  const clean = value.trim()
  if (!clean) return null
  if (hasRussianText(clean)) return clean
  return KNOWN_MESSAGES[clean.toLowerCase()] ?? null
}

function translateValidation(issue: ValidationIssue): string {
  const field = String(issue.loc?.at(-1) ?? '')
  const label = FIELD_NAMES[field] ?? 'Поле'
  const type = issue.type ?? ''
  if (field === 'email' || type.includes('email')) return 'Введите корректный адрес электронной почты.'
  if (type.includes('missing')) return `${label}: заполните это поле.`
  if (type.includes('string_too_short')) {
    const minimum = Number(issue.ctx?.min_length || 0)
    return `${label}: минимум ${minimum || 1} символов.`
  }
  if (type.includes('string_too_long')) {
    const maximum = Number(issue.ctx?.max_length || 0)
    return `${label}: не более ${maximum || 128} символов.`
  }
  return translateString(issue.msg ?? '') ?? `${label}: проверьте введённое значение.`
}

export function authErrorMessage(error: unknown, fallback: string): string {
  const requestError = (error ?? {}) as AuthRequestError
  const detail = requestError.response?.data?.detail
  if (typeof detail === 'string') {
    const translated = translateString(detail)
    if (translated) return translated
  }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const message = translateString(String((detail as { message?: unknown }).message ?? ''))
    if (message) return message
  }
  if (Array.isArray(detail) && detail.length > 0) return translateValidation(detail[0] as ValidationIssue)

  const status = requestError.response?.status
  if (!requestError.response || requestError.code === 'ERR_NETWORK') {
    return 'Нет соединения с сервером. Проверьте интернет и попробуйте снова.'
  }
  if (status === 401) return 'Неверный логин, пароль или код подтверждения.'
  if (status === 409) return 'Эти данные уже используются другим аккаунтом.'
  if (status === 422) return 'Проверьте правильность заполнения полей.'
  if (status === 429) return 'Слишком много попыток. Подождите немного и повторите.'
  if (status && status >= 500) return 'Сервис временно недоступен. Попробуйте немного позже.'

  return translateString(requestError.message ?? '') ?? fallback
}
