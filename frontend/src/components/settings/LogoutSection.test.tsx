import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { LogoutSection } from './LogoutSection'

describe('LogoutSection', () => {
  it('объясняет последствия и показывает явное действие выхода', () => {
    const html = renderToStaticMarkup(<LogoutSection onLogout={vi.fn()} />)

    expect(html).toContain('Выход из аккаунта')
    expect(html).toContain('Сессия на этом устройстве завершится')
    expect(html).toContain('Выйти')
  })
})
