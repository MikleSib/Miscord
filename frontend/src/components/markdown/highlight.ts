/** Минимальная подсветка кода без внешних зависимостей. */

export type CodeToken = {
  value: string
  kind: 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'function'
}

const KEYWORDS: Record<string, string[]> = {
  javascript: ['const','let','var','function','return','if','else','for','while','class','extends','new','await','async','import','export','from','default','try','catch','finally','throw','typeof','instanceof','null','undefined','true','false','this','switch','case','break','continue'],
  python: ['def','return','if','elif','else','for','while','class','import','from','as','with','try','except','finally','raise','lambda','None','True','False','and','or','not','in','is','pass','yield','async','await','global'],
  sql: ['select','from','where','insert','into','values','update','set','delete','join','left','right','inner','outer','on','group','by','order','limit','offset','create','table','index','alter','drop','and','or','not','null','as'],
  bash: ['if','then','else','fi','for','in','do','done','while','case','esac','function','echo','export','local','return','cd','sudo'],
  json: ['true','false','null'],
}

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
  typescript: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  postgres: 'sql',
  psql: 'sql',
}

const LINE_COMMENT: Record<string, string> = {
  javascript: '//',
  python: '#',
  bash: '#',
  sql: '--',
}

export function normalizeLanguage(language: string | null): string | null {
  if (!language) return null
  const lower = language.toLowerCase()
  const resolved = LANGUAGE_ALIASES[lower] ?? lower
  return KEYWORDS[resolved] ? resolved : null
}

function readString(source: string, index: number): number {
  const quote = source[index]
  let cursor = index + 1
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2
      continue
    }
    if (source[cursor] === quote) return cursor + 1
    if (source[cursor] === '\n' && quote !== '`') return cursor
    cursor += 1
  }
  return cursor
}

export function tokenizeCode(source: string, language: string | null): CodeToken[] {
  const resolved = normalizeLanguage(language)
  if (!resolved) return [{ value: source, kind: 'plain' }]

  const keywords = new Set(KEYWORDS[resolved])
  const comment = LINE_COMMENT[resolved]
  const tokens: CodeToken[] = []
  let plain = ''
  let index = 0

  const flush = () => {
    if (plain) tokens.push({ value: plain, kind: 'plain' })
    plain = ''
  }

  while (index < source.length) {
    const char = source[index]

    if (comment && source.startsWith(comment, index)) {
      flush()
      const lineEnd = source.indexOf('\n', index)
      const end = lineEnd === -1 ? source.length : lineEnd
      tokens.push({ value: source.slice(index, end), kind: 'comment' })
      index = end
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      flush()
      const end = readString(source, index)
      tokens.push({ value: source.slice(index, end), kind: 'string' })
      index = end
      continue
    }

    if (/[A-Za-z_]/.test(char)) {
      let end = index
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end += 1
      const word = source.slice(index, end)
      const isKeyword = keywords.has(resolved === 'sql' ? word.toLowerCase() : word)
      const isCall = source[end] === '('

      if (isKeyword || isCall) {
        flush()
        tokens.push({ value: word, kind: isKeyword ? 'keyword' : 'function' })
      } else {
        plain += word
      }
      index = end
      continue
    }

    if (/\d/.test(char)) {
      let end = index
      while (end < source.length && /[\d._xa-fA-F]/.test(source[end])) end += 1
      flush()
      tokens.push({ value: source.slice(index, end), kind: 'number' })
      index = end
      continue
    }

    plain += char
    index += 1
  }

  flush()
  return tokens
}

export const TOKEN_CLASS: Record<CodeToken['kind'], string> = {
  plain: '',
  comment: 'text-[#6c757d] italic',
  string: 'text-[#a5d6a7]',
  number: 'text-[#ffcb6b]',
  keyword: 'text-[#c792ea]',
  function: 'text-[#82aaff]',
}
