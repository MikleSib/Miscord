import { describe, expect, it } from 'vitest'
import {
  markdownToPlainText,
  parseInline,
  parseMessageMarkdown,
  previewMessageText,
  toggleInlineMarker,
  type InlineNode,
} from '../index'

function typesOf(nodes: InlineNode[]): string[] {
  return nodes.map((node) => node.type)
}

describe('инлайн-разметка', () => {
  it('разбирает жирный, курсив, подчёркнутый и зачёркнутый', () => {
    expect(typesOf(parseInline('**жирный**'))).toEqual(['strong'])
    expect(typesOf(parseInline('*курсив*'))).toEqual(['em'])
    expect(typesOf(parseInline('__подчёркнутый__'))).toEqual(['underline'])
    expect(typesOf(parseInline('~~зачёркнутый~~'))).toEqual(['strike'])
    expect(typesOf(parseInline('||спойлер||'))).toEqual(['spoiler'])
  })

  it('вкладывает курсив внутрь жирного для ***текст***', () => {
    const [node] = parseInline('***важно***')
    expect(node).toMatchObject({ type: 'strong', children: [{ type: 'em' }] })
  })

  it('не разбирает разметку внутри инлайн-кода', () => {
    const nodes = parseInline('`**не жирный**`')
    expect(nodes).toEqual([{ type: 'code', value: '**не жирный**' }])
  })

  it('не превращает snake_case в курсив', () => {
    expect(typesOf(parseInline('some_long_name'))).toEqual(['text'])
  })

  it('уважает экранирование', () => {
    expect(parseInline('\\*не курсив\\*')).toEqual([{ type: 'text', value: '*не курсив*' }])
  })

  it('оставляет непарные маркеры обычным текстом', () => {
    expect(typesOf(parseInline('2 * 2 = 4'))).toEqual(['text'])
  })

  it('разбирает упоминания', () => {
    expect(parseInline('привет <@42>')).toEqual([
      { type: 'text', value: 'привет ' },
      { type: 'mention', userId: 42 },
    ])
  })
})

describe('ссылки и безопасность', () => {
  it('разбирает markdown-ссылку с http и https', () => {
    const [node] = parseInline('[сайт](https://miscord.ru/page)')
    expect(node).toMatchObject({ type: 'link', href: 'https://miscord.ru/page' })
  })

  it('не создаёт ссылку для javascript: и data:', () => {
    expect(typesOf(parseInline('[клик](javascript:alert(1))'))).not.toContain('link')
    expect(typesOf(parseInline('[клик](data:text/html;base64,PHN2Zz4=)'))).not.toContain('link')
  })

  it('превращает голый адрес в ссылку', () => {
    const nodes = parseInline('см. https://miscord.ru')
    expect(typesOf(nodes)).toEqual(['text', 'url'])
  })
})

describe('блочная разметка', () => {
  it('разбирает блок кода с языком', () => {
    const blocks = parseMessageMarkdown('```ts\nconst a = 1\n```')
    expect(blocks).toEqual([{ type: 'codeBlock', language: 'ts', value: 'const a = 1' }])
  })

  it('закрывает незавершённый блок кода до конца сообщения', () => {
    const blocks = parseMessageMarkdown('```\nбез конца')
    expect(blocks).toEqual([{ type: 'codeBlock', language: null, value: 'без конца' }])
  })

  it('собирает подряд идущие строки цитаты в один блок', () => {
    const blocks = parseMessageMarkdown('> первая\n> вторая')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('quote')
  })

  it('разбирает заголовки и списки', () => {
    expect(parseMessageMarkdown('## Заголовок')[0]).toMatchObject({ type: 'heading', level: 2 })
    expect(parseMessageMarkdown('- один\n- два')[0]).toMatchObject({ type: 'list', ordered: false })
    expect(parseMessageMarkdown('3. три\n4. четыре')[0]).toMatchObject({
      type: 'list',
      ordered: true,
      start: 3,
    })
  })

  it('сохраняет переносы внутри абзаца', () => {
    const blocks = parseMessageMarkdown('первая\nвторая')
    expect(blocks).toHaveLength(1)
    expect(markdownToPlainText('первая\nвторая')).toBe('первая вторая')
  })

  it('не разбирает слишком длинный текст', () => {
    const long = `**${'a'.repeat(13000)}**`
    expect(parseMessageMarkdown(long)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: long }] },
    ])
  })
})

describe('превью без разметки', () => {
  it('убирает маркеры и обрезает длинный текст', () => {
    expect(markdownToPlainText('**жирный** и `код`')).toBe('жирный и код')
    expect(previewMessageText('a'.repeat(60), 50)).toBe(`${'a'.repeat(50)}...`)
    expect(previewMessageText(null)).toBe('')
  })
})

describe('горячие клавиши разметки', () => {
  it('оборачивает выделение маркером', () => {
    const result = toggleInlineMarker('привет мир', 7, 10, '**')
    expect(result.value).toBe('привет **мир**')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('мир')
  })

  it('снимает маркер, если выделение уже обёрнуто', () => {
    const result = toggleInlineMarker('привет **мир**', 9, 12, '**')
    expect(result.value).toBe('привет мир')
  })

  it('снимает маркер, если он попал внутрь выделения', () => {
    const result = toggleInlineMarker('**мир**', 0, 7, '**')
    expect(result.value).toBe('мир')
  })
})
