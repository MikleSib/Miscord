'use client'

import type { InlineNode } from '../../lib/markdown'
import { cn } from '../../lib/utils'
import { useMarkdownContext } from './context'
import { Spoiler } from './Spoiler'

function MentionChip({ userId }: { userId: number }) {
  const { currentUserId, resolveMentionLabel, onMentionClick } = useMarkdownContext()
  const isSelf = currentUserId === userId
  const label = resolveMentionLabel(userId)

  return (
    <button
      type="button"
      className={cn(
        'cursor-pointer rounded px-0.5 align-baseline font-medium',
        isSelf
          ? 'bg-[#5865f2] text-white hover:bg-[#4752c4]'
          : 'bg-[#5865f2]/30 text-[#c9cdfb] hover:bg-[#5865f2]/45',
      )}
      title={`Профиль: ${label}`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onMentionClick?.(userId, event.currentTarget.getBoundingClientRect())
      }}
    >
      @{label}
    </button>
  )
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#00a8fc] hover:underline break-all"
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </a>
  )
}

export function InlineNodes({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case 'text':
            return <span key={index}>{node.value}</span>
          case 'url':
            return (
              <ExternalLink key={index} href={node.href}>
                {node.value}
              </ExternalLink>
            )
          case 'link':
            return (
              <ExternalLink key={index} href={node.href}>
                <InlineNodes nodes={node.children} />
              </ExternalLink>
            )
          case 'mention':
            return <MentionChip key={index} userId={node.userId} />
          case 'code':
            return (
              <code
                key={index}
                className="rounded bg-[#1e1f22] px-1 py-0.5 font-mono text-[0.85em] text-[#dbdee1]"
              >
                {node.value}
              </code>
            )
          case 'strong':
            return (
              <strong key={index} className="font-semibold">
                <InlineNodes nodes={node.children} />
              </strong>
            )
          case 'em':
            return (
              <em key={index}>
                <InlineNodes nodes={node.children} />
              </em>
            )
          case 'underline':
            return (
              <span key={index} className="underline">
                <InlineNodes nodes={node.children} />
              </span>
            )
          case 'strike':
            return (
              <span key={index} className="line-through">
                <InlineNodes nodes={node.children} />
              </span>
            )
          case 'spoiler':
            return (
              <Spoiler key={index}>
                <InlineNodes nodes={node.children} />
              </Spoiler>
            )
          default:
            return null
        }
      })}
    </>
  )
}
