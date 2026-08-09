'use client'

import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { TOKEN_CLASS, normalizeLanguage, tokenizeCode } from './highlight'

interface CodeBlockProps {
  value: string
  language: string | null
}

export function CodeBlock({ value, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const tokens = useMemo(() => tokenizeCode(value, language), [value, language])
  const resolvedLanguage = normalizeLanguage(language) ?? language

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // буфер обмена может быть недоступен без https — молча игнорируем
    }
  }

  return (
    <div className="group/code relative my-1 overflow-hidden rounded-md border border-[#1e1f22] bg-[#1e1f22]">
      <div className="flex items-center justify-between gap-2 px-3 py-1">
        <span className="text-[11px] uppercase tracking-wide text-[#949ba4]">
          {resolvedLanguage || 'код'}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void copy()
          }}
          aria-label="Скопировать код"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#949ba4] opacity-0 transition-opacity hover:bg-[#ffffff14] hover:text-[#dbdee1] focus-visible:opacity-100 group-hover/code:opacity-100"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 pb-2.5 text-[13px] leading-[1.45]">
        <code className="font-mono text-[#dbdee1]">
          {tokens.map((token, index) => (
            <span key={index} className={TOKEN_CLASS[token.kind]}>
              {token.value}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}
