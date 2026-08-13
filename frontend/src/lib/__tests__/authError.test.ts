import { describe, expect, it } from 'vitest'
import { authErrorMessage } from '../authError'

describe('authErrorMessage', () => {
  it('translates known backend login errors', () => {
    expect(authErrorMessage({ response: { status: 401, data: { detail: 'Incorrect username or password' } } }, 'Ошибка'))
      .toBe('Неверный логин или пароль.')
  })

  it('translates FastAPI validation details without exposing English text', () => {
    expect(authErrorMessage({
      response: {
        status: 422,
        data: { detail: [{ loc: ['body', 'email'], type: 'value_error', msg: 'value is not a valid email address' }] },
      },
    }, 'Ошибка')).toBe('Введите корректный адрес электронной почты.')
  })

  it('keeps deliberate Russian backend recovery messages', () => {
    expect(authErrorMessage({ response: { status: 410, data: { detail: 'Код истёк. Запросите новый.' } } }, 'Ошибка'))
      .toBe('Код истёк. Запросите новый.')
  })

  it('never exposes unknown English server failures', () => {
    expect(authErrorMessage({ response: { status: 500, data: { detail: 'Internal Server Error' } } }, 'Ошибка'))
      .toBe('Сервис временно недоступен. Попробуйте немного позже.')
  })
})
