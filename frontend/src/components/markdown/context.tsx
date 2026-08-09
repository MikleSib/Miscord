'use client'

import { createContext, useContext } from 'react'

export interface MarkdownContextValue {
  currentUserId?: number
  resolveMentionLabel: (userId: number) => string
  onMentionClick?: (userId: number, anchorRect: DOMRect) => void
}

const fallback: MarkdownContextValue = {
  resolveMentionLabel: (userId) => String(userId),
}

const MarkdownContext = createContext<MarkdownContextValue>(fallback)

export const MarkdownProvider = MarkdownContext.Provider

export function useMarkdownContext(): MarkdownContextValue {
  return useContext(MarkdownContext)
}
