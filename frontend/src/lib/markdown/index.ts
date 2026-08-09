import { parseBlocks } from './blocks'
import { parseInline } from './inline'
import type { BlockNode, InlineNode } from './types'

export type { BlockNode, InlineNode } from './types'
export { parseInline } from './inline'
export { parseBlocks } from './blocks'

/** Дальше этой длины разметка не разбирается — рендерим как обычный текст. */
const MAX_MARKDOWN_LENGTH = 12000

export function parseMessageMarkdown(content: string): BlockNode[] {
  if (!content) return []
  if (content.length > MAX_MARKDOWN_LENGTH) {
    return [{ type: 'paragraph', children: [{ type: 'text', value: content }] }]
  }
  return parseBlocks(content)
}

function inlineToPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'url':
          return node.value
        case 'code':
          return node.value
        case 'mention':
          return `<@${node.userId}>`
        default:
          return inlineToPlainText(node.children)
      }
    })
    .join('')
}

function blockToPlainText(block: BlockNode): string {
  switch (block.type) {
    case 'codeBlock':
      return block.value
    case 'quote':
      return block.children.map(blockToPlainText).join(' ')
    case 'list':
      return block.items.map(inlineToPlainText).join(' ')
    default:
      return inlineToPlainText(block.children)
  }
}

/** Однострочное превью без разметки: ответы, список закреплённых, результаты поиска. */
export function markdownToPlainText(content: string): string {
  if (!content) return ''
  return parseBlocks(content)
    .map(blockToPlainText)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Обрезанное превью для узких мест интерфейса. */
export function previewMessageText(
  content: string | null | undefined,
  limit = 50,
): string {
  const plain = markdownToPlainText(content ?? '')
  if (plain.length <= limit) return plain
  return `${plain.slice(0, limit)}...`
}

/** Обрамляет выделение маркером или снимает его — для Ctrl+B и Ctrl+I в поле ввода. */
export function toggleInlineMarker(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
): { value: string; selectionStart: number; selectionEnd: number } {
  const selected = value.slice(selectionStart, selectionEnd)
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)

  const alreadyWrapped =
    before.endsWith(marker) && after.startsWith(marker)

  if (alreadyWrapped) {
    return {
      value: before.slice(0, -marker.length) + selected + after.slice(marker.length),
      selectionStart: selectionStart - marker.length,
      selectionEnd: selectionEnd - marker.length,
    }
  }

  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length > marker.length * 2) {
    const stripped = selected.slice(marker.length, -marker.length)
    return {
      value: before + stripped + after,
      selectionStart,
      selectionEnd: selectionStart + stripped.length,
    }
  }

  return {
    value: `${before}${marker}${selected}${marker}${after}`,
    selectionStart: selectionStart + marker.length,
    selectionEnd: selectionEnd + marker.length,
  }
}
