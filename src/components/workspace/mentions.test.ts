import { describe, expect, it } from 'vitest'
import {
  errorMention,
  extractSymbols,
  fileMention,
  lineRangeFor,
  selectionMention,
  symbolMention,
  withLineNumbers,
} from './mentions'

describe('withLineNumbers', () => {
  it('numbers from 1 by default', () => {
    expect(withLineNumbers('a\nb')).toBe('1 | a\n2 | b')
  })

  it('pads to a common width so the gutter stays aligned', () => {
    const text = Array.from({ length: 10 }, (_, index) => `line${index}`).join('\n')
    const lines = withLineNumbers(text).split('\n')
    expect(lines[0]).toBe(' 1 | line0')
    expect(lines[9]).toBe('10 | line9')
  })

  it('honours a non-1 start line', () => {
    expect(withLineNumbers('x\ny', 7)).toBe('7 | x\n8 | y')
  })
})

describe('lineRangeFor', () => {
  const code = 'one\ntwo\nthree\nfour'

  it('reports a single line for a within-line selection', () => {
    expect(lineRangeFor(code, 0, 3)).toEqual({ startLine: 1, endLine: 1 })
  })

  it('reports the spanned range for a multi-line selection', () => {
    // "two\nthree" starts at offset 4 and ends at offset 13.
    expect(lineRangeFor(code, 4, 13)).toEqual({ startLine: 2, endLine: 3 })
  })

  it('treats a selection ending at a newline as ending on the previous line', () => {
    expect(lineRangeFor(code, 0, 4)).toEqual({ startLine: 1, endLine: 1 })
  })
})

describe('extractSymbols', () => {
  it('finds TypeScript declarations with their bodies', () => {
    const code = [
      'export function greet(name: string) {',
      '  return `hi ${name}`',
      '}',
      '',
      'export class Store {',
      '  value = 1',
      '}',
      '',
      'export const add = (a: number, b: number) => a + b',
    ].join('\n')

    const symbols = extractSymbols(code, 'typescript')
    expect(symbols.map((symbol) => symbol.name)).toEqual(['greet', 'Store', 'add'])
    expect(symbols[0]).toMatchObject({ kind: 'function', startLine: 1, endLine: 3 })
    expect(symbols[1]).toMatchObject({ kind: 'class', startLine: 5, endLine: 7 })
    expect(symbols[0].text).toContain('return `hi ${name}`')
  })

  it('finds Python definitions by indentation', () => {
    const code = ['def greet(name):', '    return f"hi {name}"', '', 'def other():', '    pass'].join(
      '\n',
    )

    const symbols = extractSymbols(code, 'python')
    expect(symbols.map((symbol) => symbol.name)).toEqual(['greet', 'other'])
    expect(symbols[0]).toMatchObject({ startLine: 1, endLine: 2 })
    expect(symbols[1]).toMatchObject({ startLine: 4, endLine: 5 })
  })

  it('does not report the same name twice', () => {
    const code = ['function a() {}', 'function a() {}'].join('\n')
    expect(extractSymbols(code, 'typescript')).toHaveLength(1)
  })

  it('returns nothing for a buffer with no declarations', () => {
    expect(extractSymbols('const x = 1\nlet y = 2', 'typescript')).toEqual([])
  })
})

describe('mention builders', () => {
  it('fileMention carries the whole buffer and a token', () => {
    const mention = fileMention('editor.ts', 'const a = 1', 'typescript')
    expect(mention.kind).toBe('file')
    expect(mention.token).toBe('@editor.ts')
    expect(mention.payload).toContain('`editor.ts` (typescript), 1 lines')
    expect(mention.payload).toContain('const a = 1')
  })

  it('selectionMention labels a single line without a range', () => {
    const mention = selectionMention({
      text: 'const a = 1',
      startLine: 4,
      endLine: 4,
      fileName: 'editor.ts',
      language: 'typescript',
    })
    expect(mention.label).toBe('editor.ts:4')
    expect(mention.token).toBe('@selection')
    expect(mention.payload).toContain('line 4')
    expect(mention.payload).toContain('4 | const a = 1')
  })

  it('selectionMention labels a multi-line range', () => {
    const mention = selectionMention({
      text: 'a\nb',
      startLine: 2,
      endLine: 3,
      fileName: 'editor.py',
      language: 'python',
    })
    expect(mention.label).toBe('editor.py:2-3')
    expect(mention.payload).toContain('lines 2–3')
    expect(mention.payload).toContain('2 | a\n3 | b')
  })

  it('symbolMention uses the symbol name as its token', () => {
    const mention = symbolMention(
      { name: 'greet', kind: 'function', startLine: 1, endLine: 3, text: 'function greet() {}' },
      'editor.ts',
      'typescript',
    )
    expect(mention.token).toBe('@greet')
    expect(mention.payload).toContain('Symbol `greet` (function)')
    expect(mention.payload).toContain('lines 1–3')
  })

  it('errorMention truncates a long first line for its label', () => {
    const mention = errorMention(
      'TypeError: cannot read properties of undefined (reading "map")\n    at foo.ts:12',
    )
    expect(mention.kind).toBe('error')
    expect(mention.token).toBe('@error')
    expect(mention.label.endsWith('…')).toBe(true)
    expect(mention.label.length).toBeLessThanOrEqual(41)
    expect(mention.payload).toContain('at foo.ts:12')
  })

  it('gives every mention a unique id', () => {
    const a = fileMention('editor.ts', 'x', 'typescript')
    const b = fileMention('editor.ts', 'x', 'typescript')
    expect(a.id).not.toBe(b.id)
  })
})
