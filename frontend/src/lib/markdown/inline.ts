import { splitTextWithLinks, normalizeUrl } from '../linkify'
import { MAX_INLINE_DEPTH, type InlineNode } from './types'

const ESCAPABLE = new Set(['*', '_', '~', '`', '|', '\\', '[', ']', '(', ')', '>', '#', '-'])

type WrapType = 'strong' | 'em' | 'underline' | 'strike' | 'spoiler'

/** Порядок важен: длинные маркеры проверяются раньше своих префиксов. */
const WRAPPERS: { marker: string; type: WrapType; wrapInner?: WrapType }[] = [
  { marker: '||', type: 'spoiler' },
  { marker: '***', type: 'strong', wrapInner: 'em' },
  { marker: '**', type: 'strong' },
  { marker: '__', type: 'underline' },
  { marker: '~~', type: 'strike' },
  { marker: '*', type: 'em' },
  { marker: '_', type: 'em' },
]

function pushText(nodes: InlineNode[], text: string): void {
  if (!text) return
  for (const segment of splitTextWithLinks(text)) {
    nodes.push(segment)
  }
}

function readMention(text: string, index: number): { userId: number; length: number } | null {
  if (text[index] !== '<' || text[index + 1] !== '@') return null
  const close = text.indexOf('>', index + 2)
  if (close === -1) return null
  const raw = text.slice(index + 2, close)
  if (!/^\d{1,18}$/.test(raw)) return null
  return { userId: Number(raw), length: close - index + 1 }
}

/** Инлайн-код: `код` или ``код с ` внутри``. */
function readCode(text: string, index: number): { value: string; length: number } | null {
  if (text[index] !== '`') return null
  let fenceLength = 0
  while (text[index + fenceLength] === '`') fenceLength += 1

  const fence = '`'.repeat(fenceLength)
  const contentStart = index + fenceLength
  const close = text.indexOf(fence, contentStart)
  if (close === -1) return null

  const value = text.slice(contentStart, close)
  if (!value.trim()) return null
  return { value: value.replace(/^ | $/g, ''), length: close + fenceLength - index }
}

/** Ссылка [подпись](https://...). Схема проверяется, javascript: не пройдёт. */
function readLink(text: string, index: number): { href: string; label: string; length: number } | null {
  if (text[index] !== '[') return null
  const labelEnd = text.indexOf(']', index + 1)
  if (labelEnd === -1 || text[labelEnd + 1] !== '(') return null

  const hrefEnd = text.indexOf(')', labelEnd + 2)
  if (hrefEnd === -1) return null

  const label = text.slice(index + 1, labelEnd)
  const rawHref = text.slice(labelEnd + 2, hrefEnd).trim()
  if (!label.trim() || /\n/.test(label) || !rawHref) return null

  const href = normalizeUrl(rawHref)
  if (!href) return null
  return { href, label, length: hrefEnd - index + 1 }
}

function findClosing(text: string, from: number, marker: string): number {
  let index = from
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text.startsWith(marker, index)) return index
    index += 1
  }
  return -1
}

function readWrapper(
  text: string,
  index: number,
  depth: number,
): { node: InlineNode; length: number } | null {
  for (const { marker, type, wrapInner } of WRAPPERS) {
    if (!text.startsWith(marker, index)) continue

    const contentStart = index + marker.length
    const close = findClosing(text, contentStart, marker)
    if (close === -1 || close === contentStart) continue

    const inner = text.slice(contentStart, close)
    // `snake_case_word` не должен превращаться в курсив
    if (marker === '_' && /\w/.test(text[index - 1] ?? '')) continue

    const children = parseInline(inner, depth + 1)
    const node: InlineNode = wrapInner
      ? { type, children: [{ type: wrapInner, children }] }
      : { type, children }
    return { node, length: close + marker.length - index }
  }
  return null
}

export function parseInline(text: string, depth = 0): InlineNode[] {
  const nodes: InlineNode[] = []
  let buffer = ''
  let index = 0

  const flush = () => {
    pushText(nodes, buffer)
    buffer = ''
  }

  while (index < text.length) {
    const char = text[index]

    if (char === '\\' && ESCAPABLE.has(text[index + 1] ?? '')) {
      buffer += text[index + 1]
      index += 2
      continue
    }

    const mention = readMention(text, index)
    if (mention) {
      flush()
      nodes.push({ type: 'mention', userId: mention.userId })
      index += mention.length
      continue
    }

    const code = readCode(text, index)
    if (code) {
      flush()
      nodes.push({ type: 'code', value: code.value })
      index += code.length
      continue
    }

    if (depth < MAX_INLINE_DEPTH) {
      const link = readLink(text, index)
      if (link) {
        flush()
        nodes.push({ type: 'link', href: link.href, children: parseInline(link.label, depth + 1) })
        index += link.length
        continue
      }

      const wrapper = readWrapper(text, index, depth)
      if (wrapper) {
        flush()
        nodes.push(wrapper.node)
        index += wrapper.length
        continue
      }
    }

    buffer += char
    index += 1
  }

  flush()
  return nodes
}
