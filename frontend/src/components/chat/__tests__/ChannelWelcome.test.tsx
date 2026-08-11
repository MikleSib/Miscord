import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ChannelWelcome } from '../ChannelWelcome'

describe('ChannelWelcome', () => {
  it('объясняет начало канала и показывает настройку модератору', () => {
    const html = renderToStaticMarkup(
      <ChannelWelcome channelName="идеи" canManage onConfigure={() => undefined} />,
    )

    expect(html).toContain('Добро пожаловать на канал #идеи!')
    expect(html).toContain('Это начало канала #идеи.')
    expect(html).toContain('Настроить канал')
  })

  it('не показывает настройку участнику без права управления каналами', () => {
    const html = renderToStaticMarkup(
      <ChannelWelcome channelName="общий" canManage={false} onConfigure={() => undefined} />,
    )

    expect(html).not.toContain('Настроить канал')
  })
})
