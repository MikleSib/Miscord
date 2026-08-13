const FRIEND_REQUEST_ERRORS: Record<string, string> = {
  'Friend request already sent or users are already friends.': 'Запрос уже отправлен или пользователь уже у вас в друзьях.',
  'Friend request not found or you are not the recipient.': 'Запрос в друзья не найден или уже обработан.',
}

type ApiError = {
  response?: {
    status?: number
    data?: { detail?: unknown }
  }
  request?: unknown
}

export function getFriendRequestError(error: unknown): string {
  const apiError = error as ApiError
  const detail = apiError?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) {
    return FRIEND_REQUEST_ERRORS[detail] ?? detail
  }

  if (apiError?.response?.status === 404) return 'Пользователь с таким логином не найден.'
  if (apiError?.response?.status === 429) return 'Слишком много запросов. Попробуйте немного позже.'
  if (apiError?.request && !apiError?.response) return 'Нет связи с сервером. Проверьте интернет и повторите попытку.'
  return 'Не удалось отправить запрос. Попробуйте ещё раз.'
}
