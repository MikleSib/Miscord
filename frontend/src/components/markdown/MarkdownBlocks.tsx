'use client'

import type { BlockNode } from '../../lib/markdown'
import { CodeBlock } from './CodeBlock'
import { InlineNodes } from './InlineNodes'

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'text-lg font-bold',
  2: 'text-base font-bold',
  3: 'text-sm font-bold',
}

export function MarkdownBlocks({ blocks }: { blocks: BlockNode[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'paragraph':
            return (
              <p key={index} className="whitespace-pre-wrap break-words">
                <InlineNodes nodes={block.children} />
              </p>
            )
          case 'heading':
            return (
              <p key={index} className={`${HEADING_CLASS[block.level]} break-words text-[#f2f3f5]`}>
                <InlineNodes nodes={block.children} />
              </p>
            )
          case 'codeBlock':
            return <CodeBlock key={index} value={block.value} language={block.language} />
          case 'quote':
            return (
              <blockquote
                key={index}
                className="my-0.5 border-l-4 border-[#4e5058] pl-3 text-[#dbdee1]"
              >
                <MarkdownBlocks blocks={block.children} />
              </blockquote>
            )
          case 'list': {
            const className = 'my-0.5 space-y-0.5 pl-5'
            const items = block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="break-words">
                <InlineNodes nodes={item} />
              </li>
            ))
            return block.ordered ? (
              <ol key={index} start={block.start} className={`${className} list-decimal`}>
                {items}
              </ol>
            ) : (
              <ul key={index} className={`${className} list-disc`}>
                {items}
              </ul>
            )
          }
          default:
            return null
        }
      })}
    </>
  )
}
