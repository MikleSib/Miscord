import { parseInline } from './inline'
import { MAX_QUOTE_DEPTH, type BlockNode } from './types'

const CODE_FENCE_RE = /^```(\w{1,20})?\s*$/
const HEADING_RE = /^(#{1,3})\s+(.*)$/
const QUOTE_RE = /^>\s?(.*)$/
const BULLET_RE = /^[-*]\s+(.+)$/
const ORDERED_RE = /^(\d{1,3})[.)]\s+(.+)$/

function isBlockStart(line: string): boolean {
  return (
    CODE_FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    QUOTE_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line)
  )
}

function readCodeBlock(lines: string[], start: number): { block: BlockNode; next: number } {
  const language = lines[start].match(CODE_FENCE_RE)?.[1] ?? null
  const body: string[] = []
  let index = start + 1

  while (index < lines.length && !/^```\s*$/.test(lines[index])) {
    body.push(lines[index])
    index += 1
  }

  return {
    block: { type: 'codeBlock', language, value: body.join('\n') },
    // Пропускаем закрывающий забор, если он есть
    next: index < lines.length ? index + 1 : index,
  }
}

function readQuote(lines: string[], start: number, depth: number): { block: BlockNode; next: number } {
  const inner: string[] = []
  let index = start

  while (index < lines.length) {
    const match = lines[index].match(QUOTE_RE)
    if (!match) break
    inner.push(match[1])
    index += 1
  }

  const children =
    depth < MAX_QUOTE_DEPTH
      ? parseBlocks(inner.join('\n'), depth + 1)
      : [{ type: 'paragraph' as const, children: parseInline(inner.join('\n')) }]

  return { block: { type: 'quote', children }, next: index }
}

function readList(lines: string[], start: number, ordered: boolean): { block: BlockNode; next: number } {
  const pattern = ordered ? ORDERED_RE : BULLET_RE
  const items: string[] = []
  let index = start
  let listStart = 1

  while (index < lines.length) {
    const match = lines[index].match(pattern)
    if (!match) break
    if (ordered) {
      if (items.length === 0) listStart = Number(match[1])
      items.push(match[2])
    } else {
      items.push(match[1])
    }
    index += 1
  }

  return {
    block: {
      type: 'list',
      ordered,
      start: listStart,
      items: items.map((item) => parseInline(item)),
    },
    next: index,
  }
}

function readParagraph(lines: string[], start: number): { block: BlockNode | null; next: number } {
  const body: string[] = []
  let index = start

  while (index < lines.length && lines[index].trim() !== '' && !isBlockStart(lines[index])) {
    body.push(lines[index])
    index += 1
  }

  if (body.length === 0) return { block: null, next: index + 1 }
  return { block: { type: 'paragraph', children: parseInline(body.join('\n')) }, next: index }
}

export function parseBlocks(content: string, depth = 0): BlockNode[] {
  const lines = content.split('\n')
  const blocks: BlockNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (line.trim() === '') {
      index += 1
      continue
    }

    if (CODE_FENCE_RE.test(line)) {
      const { block, next } = readCodeBlock(lines, index)
      blocks.push(block)
      index = next
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2]),
      })
      index += 1
      continue
    }

    if (QUOTE_RE.test(line)) {
      const { block, next } = readQuote(lines, index, depth)
      blocks.push(block)
      index = next
      continue
    }

    if (BULLET_RE.test(line) || ORDERED_RE.test(line)) {
      const { block, next } = readList(lines, index, ORDERED_RE.test(line))
      blocks.push(block)
      index = next
      continue
    }

    const { block, next } = readParagraph(lines, index)
    if (block) blocks.push(block)
    index = next
  }

  return blocks
}
