import { describe, expect, it } from 'vitest'
import {
  applyHunks,
  buildHunks,
  describeManualEdits,
  diffLines,
  diffStats,
} from './diff'

describe('diffLines', () => {
  it('reports no changes for identical text', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc')
    expect(lines.every((line) => line.op === 'context')).toBe(true)
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0 })
  })

  it('marks a changed line as a removal followed by an addition', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc')
    expect(lines.map((line) => line.op)).toEqual(['context', 'remove', 'add', 'context'])
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 })
  })

  it('numbers both sides, leaving the missing side null', () => {
    const lines = diffLines('a\nb', 'a\nx\nb')
    const added = lines.find((line) => line.op === 'add')
    expect(added).toMatchObject({ text: 'x', oldLine: null, newLine: 2 })
    expect(lines.at(-1)).toMatchObject({ text: 'b', oldLine: 2, newLine: 3 })
  })

  it('handles pure insertions and pure deletions', () => {
    // An empty buffer is one empty line, so it reads as a removal plus the
    // lines that replaced it.
    expect(diffStats(diffLines('', 'a\nb'))).toEqual({ added: 2, removed: 1 })
    expect(diffStats(diffLines('a\nb', ''))).toEqual({ added: 1, removed: 2 })
  })
})

describe('buildHunks', () => {
  it('keeps context around a change and merges nearby ones', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 5', 'changed 5').replace('line 7', 'changed 7')
    const hunks = buildHunks(diffLines(before, after), 3)
    // Two changes three lines apart share their context window.
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines.some((line) => line.text === 'changed 5')).toBe(true)
    expect(hunks[0].lines.some((line) => line.text === 'changed 7')).toBe(true)
  })

  it('splits changes that are far apart', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 2', 'changed 2').replace('line 35', 'changed 35')
    expect(buildHunks(diffLines(before, after), 3)).toHaveLength(2)
  })
})

describe('applyHunks', () => {
  const before = 'a\nb\nc\nd\ne'
  const after = 'a\nB\nc\nD\ne'

  it('returns the agent text when every hunk is accepted', () => {
    const lines = diffLines(before, after)
    const hunks = buildHunks(lines, 1)
    const accepted = new Set(hunks.map((_, index) => index))
    expect(applyHunks(lines, hunks, accepted)).toBe(after)
  })

  it('returns the original text when no hunk is accepted', () => {
    const lines = diffLines(before, after)
    const hunks = buildHunks(lines, 1)
    expect(applyHunks(lines, hunks, new Set())).toBe(before)
  })

  it('mixes accepted and rejected hunks', () => {
    const lines = diffLines(before, after)
    // No context, so the two changes stay separate hunks.
    const hunks = buildHunks(lines, 0)
    expect(hunks).toHaveLength(2)
    // Accept only the first change.
    expect(applyHunks(lines, hunks, new Set([0]))).toBe('a\nB\nc\nd\ne')
    // Accept only the second.
    expect(applyHunks(lines, hunks, new Set([1]))).toBe('a\nb\nc\nD\ne')
  })
})

describe('describeManualEdits', () => {
  it('returns null when nothing changed', () => {
    expect(describeManualEdits('a\nb', 'a\nb')).toBeNull()
  })

  it('describes a hand edit as a unified diff', () => {
    const text = describeManualEdits('a\nb\nc', 'a\nB\nc')
    expect(text).toContain('@@')
    expect(text).toContain('-b')
    expect(text).toContain('+B')
  })

  it('truncates a very large edit', () => {
    const before = ''
    const after = Array.from({ length: 2000 }, (_, i) => `line ${i} with some padding text`).join('\n')
    const text = describeManualEdits(before, after)
    expect(text).not.toBeNull()
    expect(text!.length).toBeLessThan(3200)
    expect(text).toContain('truncated')
  })
})
