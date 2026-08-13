import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { User } from '../../types'
import { HomeConversationSidebar } from './HomeConversationSidebar'

const conversations: User[] = [
  {
    id: 2,
    username: 'older',
    display_name: 'Старый диалог',
    last_message_at: '2026-08-12T10:00:00Z',
  },
  {
    id: 3,
    username: 'recent',
    display_name: 'Новый диалог',
    is_online: true,
    last_message_at: '2026-08-13T10:00:00Z',
  },
]

describe('HomeConversationSidebar', () => {
  it('показывает только реальные диалоги в порядке последней активности', () => {
    const html = renderToStaticMarkup(
      <HomeConversationSidebar
        conversations={conversations}
        pendingCount={0}
        onOpenFriends={vi.fn()}
        onOpenConversation={vi.fn()}
        onHideConversation={vi.fn()}
      />,
    )

    expect(html).toContain('Личные сообщения — 2')
    expect(html.indexOf('Новый диалог')).toBeLessThan(html.indexOf('Старый диалог'))
  })

  it('даёт каждой строке доступную кнопку скрытия вместо постоянной иконки чата', () => {
    const html = renderToStaticMarkup(
      <HomeConversationSidebar
        conversations={[conversations[0]]}
        pendingCount={4}
        selectedUserId={2}
        onOpenFriends={vi.fn()}
        onOpenConversation={vi.fn()}
        onHideConversation={vi.fn()}
      />,
    )

    expect(html).toContain('home-conversation-row group is-active')
    expect(html).toContain('aria-label="Скрыть диалог с Старый диалог"')
    expect(html).toContain('Ожидающих запросов: 4')
  })
})
