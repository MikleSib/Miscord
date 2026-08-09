/** Дерево разметки сообщения. Рендерится только в React-элементы, без HTML. */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string; href: string }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'mention'; userId: number }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'underline'; children: InlineNode[] }
  | { type: 'strike'; children: InlineNode[] }
  | { type: 'spoiler'; children: InlineNode[] }

export type BlockNode =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: 'codeBlock'; language: string | null; value: string }
  | { type: 'quote'; children: BlockNode[] }
  | { type: 'list'; ordered: boolean; start: number; items: InlineNode[][] }

/** Защита от текста вида `*`.repeat(2000) — дальше вложенность не разбирается. */
export const MAX_INLINE_DEPTH = 6
export const MAX_QUOTE_DEPTH = 3
