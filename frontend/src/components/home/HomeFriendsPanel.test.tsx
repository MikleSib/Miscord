import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { User } from '../../types'
import { HomeFriendsPanel } from './HomeFriendsPanel'

const friends: User[] = [
  { id: 1, username: 'online', display_name: 'В сети', is_online: true },
  { id: 2, username: 'offline', display_name: 'Не в сети', is_online: false },
]

function render(activeTab: 'online' | 'all' | 'pending') {
  return renderToStaticMarkup(
    <HomeFriendsPanel
      activeTab={activeTab}
      friends={friends}
      pendingRequests={[{ id: 8, request_id: 8, username: 'request' }]}
      onTabChange={vi.fn()}
      onAddFriend={vi.fn()}
      onOpenConversation={vi.fn()}
      onAcceptRequest={vi.fn()}
      onRejectRequest={vi.fn()}
    />,
  )
}

describe('HomeFriendsPanel', () => {
  it('показывает общую навигацию, поиск и правую панель активности', () => {
    const html = render('online')

    expect(html).toContain('Разделы друзей')
    expect(html).toContain('placeholder="Поиск"')
    expect(html).toContain('Активные контакты')
    expect(html).toContain('В сети — 1')
    expect(html).not.toContain('Не в сети</strong>')
  })

  it('показывает счётчик и действия ожидающего запроса', () => {
    const html = render('pending')

    expect(html).toContain('Ожидание — 1')
    expect(html).toContain('Принять запрос от request')
    expect(html).toContain('Отклонить запрос от request')
  })
})
