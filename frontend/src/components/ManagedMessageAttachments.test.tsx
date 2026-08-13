import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ManagedMessageAttachments } from './ManagedMessageAttachments'


describe('ManagedMessageAttachments', () => {
  it('preloads video inside a stable reserved frame', () => {
    const html = renderToStaticMarkup(
      <ManagedMessageAttachments
        attachments={[{
          id: 7,
          file_url: '/api/v1/attachments/7/video.mp4',
          filename: 'video.mp4',
          content_type: 'video/mp4',
          size_bytes: 1024,
        }]}
      />,
    )

    expect(html).toContain('preload="auto"')
    expect(html).toContain('aspect-video')
    expect(html).toContain('object-contain')
    expect(html).not.toContain('preload="none"')
  })
})
