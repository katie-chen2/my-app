/**
 * Context mentions — the `@file`, `@symbol`, `@selection`, `@error` tokens the
 * composer understands.
 *
 * A mention is two things at once: a short `token` the user sees in their
 * message (`@greet`), and a `payload` block appended to the wire content so the
 * model gets the actual text. Keeping them separate means the transcript stays
 * readable while the model still receives the full context.
 */

export type MentionKind = 'file' | 'selection' | 'symbol' | 'error'

export interface Mention {
  id: string
  kind: MentionKind
  /** Short label shown in the chip and inserted as `@label`. */
  label: string
  /** What lands in the message body. */
  token: string
  /** What gets appended to the wire payload. */
  payload: string
}

/** A range of the editor buffer the user selected. */
export interface SelectionContext {
  text: string
  /** 1-based, inclusive. */
  startLine: number
  /** 1-based, inclusive. */
  endLine: number
  fileName: string
  language: string
}

export interface SymbolInfo {
  name: string
  kind: string
  /** 1-based, inclusive. */
  startLine: number
  /** 1-based, inclusive. */
  endLine: number
  text: string
}

/** Prefix every line with its 1-based number, so the model can cite lines. */
export function withLineNumbers(text: string, startLine = 1): string {
  const lines = text.split('\n')
  const width = String(startLine + lines.length - 1).length
  return lines
    .map((line, index) => `${String(startLine + index).padStart(width, ' ')} | ${line}`)
    .join('\n')
}

function newId(kind: MentionKind): string {
  return `mention-${kind}-${crypto.randomUUID()}`
}

/** The whole buffer, as a file the model can reason about. */
export function fileMention(fileName: string, code: string, language: string): Mention {
  return {
    id: newId('file'),
    kind: 'file',
    label: fileName,
    token: `@${fileName}`,
    payload: [
      `File \`${fileName}\` (${language}), ${code.split('\n').length} lines:`,
      '```' + language,
      code,
      '```',
    ].join('\n'),
  }
}

/** A selected range, with line numbers so the model can refer to them. */
export function selectionMention(selection: SelectionContext): Mention {
  const { text, startLine, endLine, fileName, language } = selection
  const range = startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`
  return {
    id: newId('selection'),
    kind: 'selection',
    label: `${fileName}:${startLine}${endLine === startLine ? '' : `-${endLine}`}`,
    token: `@selection`,
    payload: [
      `Selection from \`${fileName}\`, ${range}:`,
      '```' + language,
      withLineNumbers(text, startLine),
      '```',
    ].join('\n'),
  }
}

/** One function/class/type, with its body. */
export function symbolMention(symbol: SymbolInfo, fileName: string, language: string): Mention {
  return {
    id: newId('symbol'),
    kind: 'symbol',
    label: symbol.name,
    token: `@${symbol.name}`,
    payload: [
      `Symbol \`${symbol.name}\` (${symbol.kind}) in \`${fileName}\`, lines ${symbol.startLine}–${symbol.endLine}:`,
      '```' + language,
      withLineNumbers(symbol.text, symbol.startLine),
      '```',
    ].join('\n'),
  }
}

/** Terminal output the user pasted, verbatim. */
export function errorMention(text: string): Mention {
  const firstLine = text.trim().split('\n')[0] ?? 'error'
  const label = firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine
  return {
    id: newId('error'),
    kind: 'error',
    label,
    token: '@error',
    payload: ['Terminal output the user pasted:', '```text', text.trim(), '```'].join('\n'),
  }
}

const SYMBOL_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'function', re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'class', re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'interface', re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'type', re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/ },
  {
    kind: 'const',
    re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  },
  { kind: 'def', re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
  { kind: 'func', re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/ },
  { kind: 'fn', re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/ },
]

/** Where a declaration's body ends, so a symbol mention carries the whole thing. */
function findBlockEnd(lines: string[], startIndex: number, language: string): number {
  if (language === 'python') {
    const baseIndent = lines[startIndex].search(/\S/)
    let lastContent = startIndex
    for (let index = startIndex + 1; index < lines.length; index++) {
      const line = lines[index]
      if (!line.trim()) continue
      if (line.search(/\S/) <= baseIndent) break
      lastContent = index
    }
    return lastContent
  }

  let depth = 0
  let opened = false
  for (let index = startIndex; index < lines.length; index++) {
    for (const char of lines[index]) {
      if (char === '{') {
        depth++
        opened = true
      } else if (char === '}') {
        depth--
        if (opened && depth === 0) return index
      }
    }
  }
  // No braces (a one-line declaration, or a language we don't parse): keep it
  // short rather than swallowing the rest of the file.
  return Math.min(startIndex + 20, lines.length - 1)
}

/**
 * Pull top-level declarations out of the buffer.
 *
 * Deliberately regex-based: this feeds a mention picker, not a language
 * server, and a wrong guess costs the user one glance at the payload.
 */
export function extractSymbols(code: string, language: string): SymbolInfo[] {
  const lines = code.split('\n')
  const symbols: SymbolInfo[] = []
  const seen = new Set<string>()

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    for (const { kind, re } of SYMBOL_PATTERNS) {
      const match = re.exec(line)
      if (!match) continue
      const name = match[1]
      if (seen.has(name)) break
      seen.add(name)
      const endIndex = findBlockEnd(lines, index, language)
      symbols.push({
        name,
        kind,
        startLine: index + 1,
        endLine: endIndex + 1,
        text: lines.slice(index, endIndex + 1).join('\n'),
      })
      break
    }
  }

  return symbols
}

/** The 1-based line range a text offset range covers. */
export function lineRangeFor(
  code: string,
  start: number,
  end: number,
): { startLine: number; endLine: number } {
  const before = code.slice(0, start)
  const startLine = before.split('\n').length
  // A selection that stops just before a newline ends on the line above it,
  // not on the empty line the trailing `\n` would imply.
  const selected = code.slice(start, end).replace(/\n$/, '')
  const endLine = startLine + selected.split('\n').length - 1
  return { startLine, endLine }
}
