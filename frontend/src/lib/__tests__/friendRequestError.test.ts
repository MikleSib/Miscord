import { describe, expect, it } from 'vitest'
import { getFriendRequestError } from '../friendRequestError'

describe('friend request errors', () => {
  it('translates legacy API errors', () => {
    expect(getFriendRequestError({ response: { data: { detail: 'Friend request already sent or users are already friends.' } } }))
      .toBe('Запрос уже отправлен или пользователь уже у вас в друзьях.')
  })

  it('preserves an actionable Russian API message', () => {
    expect(getFriendRequestError({ response: { data: { detail: 'Пользователь отключил запросы в друзья.' } } }))
      .toBe('Пользователь отключил запросы в друзья.')
  })

  it('uses a Russian recovery message for a network failure', () => {
    expect(getFriendRequestError({ request: {} }))
      .toBe('Нет связи с сервером. Проверьте интернет и повторите попытку.')
  })
})
