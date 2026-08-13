import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { MessageComposerUnavailable } from '../MessageComposerUnavailable'

describe('MessageComposerUnavailable', () => {
  it('explains that sending is unavailable without rendering a text field', () => {
    const html = renderToStaticMarkup(
      <MessageComposerUnavailable status="denied" onRetry={vi.fn()} />,
    )

    expect(html).toContain('У вас недостаточно прав, чтобы отправлять сообщения на этом канале.')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('<input')
  })

  it('offers recovery when the permission check fails', () => {
    const html = renderToStaticMarkup(
      <MessageComposerUnavailable status="error" onRetry={vi.fn()} />,
    )

    expect(html).toContain('Не удалось проверить права для этого канала.')
    expect(html).toContain('Повторить')
  })
})
