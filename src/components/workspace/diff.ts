/**
 * Line diffing for the editor's review pane.
 *
 * The agent returns whole files, not patches, so the UI has to derive the
 * change itself. This is a plain LCS line diff: trim the common prefix and
 * suffix (which is where almost all of a typical edit lives), then run the
 * table on what's left. That keeps the O(n·m) table small for the common case
 * and falls back to a single replace block when a file is too large to diff
 * cheaply.
 */

export type DiffOp = 'context' | 'add' | 'remove'

export interface DiffLine {
  op: DiffOp
  text: string
  /** 1-based line number in the "before" text; null for added lines. */
  oldLine: number | null
  /** 1-based line number in the "after" text; null for removed lines. */
  newLine: number | null
}

export interface DiffHunk {
  lines: DiffLine[]
  /** Index of this hunk's first line in the full `DiffLine[]`. */
  startIndex: number
  /** Index of this hunk's last line in the full `DiffLine[]`. */
  endIndex: number
  /** Unchanged lines omitted between the previous hunk and this one. */
  skippedBefore: number
  /** 1-based start line in the "before" text. */
  oldStart: number
  /** 1-based start line in the "after" text. */
  newStart: number
}

export interface DiffStats {
  added: number
  removed: number
}

/** A whole-file replacement the agent proposed, held until the user decides. */
export interface CodeProposal {
  /** Stable id, so the UI can tell two proposals apart. */
  id: string
  /** The full replacement text. */
  code: string
  /** Language hint from the fenced block, when the agent supplied one. */
  language?: string
  /** The buffer this proposal was generated against. */
  baseCode: string
}

/** Above this many cells the LCS table is skipped in favour of a coarse diff. */
const MAX_LCS_CELLS = 1_000_000

type MiddleOp = { op: DiffOp; text: string }

function diffMiddle(a: string[], b: string[]): MiddleOp[] {
  if (a.length === 0) return b.map((text) => ({ op: 'add' as const, text }))
  if (b.length === 0) return a.map((text) => ({ op: 'remove' as const, text }))

  if (a.length * b.length > MAX_LCS_CELLS) {
    // Too big to align line by line: report the region as one replacement.
    return [
      ...a.map((text) => ({ op: 'remove' as const, text })),
      ...b.map((text) => ({ op: 'add' as const, text })),
    ]
  }

  const n = a.length
  const m = b.length
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }

  const out: MiddleOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'context', text: a[i] })
      i++
      j++
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      // Prefer removals first so a changed line reads as "-old" then "+new".
      out.push({ op: 'remove', text: a[i] })
      i++
    } else {
      out.push({ op: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ op: 'remove', text: a[i++] })
  while (j < m) out.push({ op: 'add', text: b[j++] })

  return out
}

/** Diff two texts line by line, with line numbers on both sides. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++

  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const out: DiffLine[] = []
  for (let i = 0; i < start; i++) {
    out.push({ op: 'context', text: a[i], oldLine: i + 1, newLine: i + 1 })
  }

  let oldNo = start + 1
  let newNo = start + 1
  for (const entry of diffMiddle(a.slice(start, endA), b.slice(start, endB))) {
    if (entry.op === 'context') {
      out.push({ op: 'context', text: entry.text, oldLine: oldNo++, newLine: newNo++ })
    } else if (entry.op === 'remove') {
      out.push({ op: 'remove', text: entry.text, oldLine: oldNo++, newLine: null })
    } else {
      out.push({ op: 'add', text: entry.text, oldLine: null, newLine: newNo++ })
    }
  }

  for (let i = endA; i < a.length; i++) {
    out.push({
      op: 'context',
      text: a[i],
      oldLine: i + 1,
      newLine: endB + (i - endA) + 1,
    })
  }

  return out
}

/** Count added and removed lines. */
export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.op === 'add') added++
    else if (line.op === 'remove') removed++
  }
  return { added, removed }
}

/**
 * Group changed lines into hunks, keeping `context` unchanged lines on either
 * side and merging hunks that would otherwise overlap.
 */
export function buildHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const ranges: Array<[number, number]> = []

  for (let index = 0; index < lines.length; index++) {
    if (lines[index].op === 'context') continue
    const start = Math.max(0, index - context)
    const end = Math.min(lines.length - 1, index + context)
    const last = ranges[ranges.length - 1]
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else ranges.push([start, end])
  }

  return ranges.map(([start, end], index) => {
    const slice = lines.slice(start, end + 1)
    const first = slice[0]
    return {
      lines: slice,
      startIndex: start,
      endIndex: end,
      skippedBefore: index === 0 ? start : start - ranges[index - 1][1] - 1,
      oldStart: first.oldLine ?? lines.slice(0, start).filter((l) => l.oldLine !== null).length + 1,
      newStart: first.newLine ?? lines.slice(0, start).filter((l) => l.newLine !== null).length + 1,
    }
  })
}

/**
 * Rebuild the text from a diff, taking the "after" side of accepted hunks and
 * the "before" side of the rest. This is what lets the user accept one change
 * and reject another from the same proposal.
 */
export function applyHunks(lines: DiffLine[], hunks: DiffHunk[], accepted: Set<number>): string {
  const out: string[] = []
  let cursor = 0

  hunks.forEach((hunk, hunkIndex) => {
    for (; cursor < hunk.startIndex; cursor++) {
      const line = lines[cursor]
      if (line.op !== 'add') out.push(line.text)
    }

    const takeNewSide = accepted.has(hunkIndex)
    for (; cursor <= hunk.endIndex; cursor++) {
      const line = lines[cursor]
      if (line.op === 'context') out.push(line.text)
      else if (line.op === 'add' && takeNewSide) out.push(line.text)
      else if (line.op === 'remove' && !takeNewSide) out.push(line.text)
    }
  })

  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor]
    if (line.op !== 'add') out.push(line.text)
  }

  return out.join('\n')
}

/** Longest manual-edit description we will put in a prompt. */
const MAX_EDIT_DESCRIPTION = 3000

/**
 * Describe how the user changed the buffer by hand since the agent last saw
 * it, as a compact diff. Returns null when nothing changed.
 *
 * This is what makes the agent aware of manual edits: the next turn carries
 * the changed regions explicitly, so the model can preserve them instead of
 * regenerating from its own last output and silently reverting the user.
 */
export function describeManualEdits(before: string, after: string): string | null {
  if (before === after) return null

  const lines = diffLines(before, after)
  const hunks = buildHunks(lines, 2)
  if (hunks.length === 0) return null

  const parts: string[] = []
  for (const hunk of hunks) {
    parts.push(`@@ -${hunk.oldStart} +${hunk.newStart} @@`)
    for (const line of hunk.lines) {
      if (line.op === 'context') parts.push(` ${line.text}`)
      else if (line.op === 'remove') parts.push(`-${line.text}`)
      else parts.push(`+${line.text}`)
    }
  }

  const text = parts.join('\n')
  if (text.length <= MAX_EDIT_DESCRIPTION) return text
  return `${text.slice(0, MAX_EDIT_DESCRIPTION)}\n… (truncated)`
}
