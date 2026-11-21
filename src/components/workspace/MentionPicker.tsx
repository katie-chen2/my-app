/**
 * The `@` mention picker for the composer.
 *
 * Typing `@` opens a filtered list of things the agent can be pointed at: the
 * whole file, the current selection, every symbol in the buffer, and any
 * terminal output the user pasted. Choosing one inserts a short `@token` into
 * the message and stashes the full payload to send alongside it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Braces, FileCode2, TextSelect } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Mention, MentionKind } from './mentions'

interface MentionPickerProps {
  /** Everything the user can point at right now. */
  options: Mention[]
  /** The text typed after `@`, used to filter. */
  query: string
  onSelect: (mention: Mention) => void
  onClose: () => void
  className?: string
}

const KIND_ICON: Record<MentionKind, typeof FileCode2> = {
  file: FileCode2,
  selection: TextSelect,
  symbol: Braces,
  error: AlertTriangle,
}

const KIND_LABEL: Record<MentionKind, string> = {
  file: 'File',
  selection: 'Selection',
  symbol: 'Symbol',
  error: 'Terminal',
}

/** Rank matches: prefix beats substring, and shorter labels beat longer ones. */
function score(mention: Mention, query: string): number {
  if (!query) return 0
  const label = mention.label.toLowerCase()
  const needle = query.toLowerCase()
  if (label.startsWith(needle)) return 0
  if (label.includes(needle)) return 1
  if (mention.kind.startsWith(needle)) return 2
  return -1
}

export function MentionPicker({
  options,
  query,
  onSelect,
  onClose,
  className,
}: MentionPickerProps) {
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    return options
      .map((mention) => ({ mention, rank: score(mention, query) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.mention.label.length - b.mention.label.length)
      .map((entry) => entry.mention)
      .slice(0, 8)
  }, [options, query])

  // Reset the highlight whenever the result set changes, so Enter never picks
  // something the user hasn't seen.
  useEffect(() => {
    setActive(0)
  }, [query])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (matches.length === 0) {
        if (event.key === 'Escape') onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setActive((prev) => (prev + 1) % matches.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setActive((prev) => (prev - 1 + matches.length) % matches.length)
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        onSelect(matches[active])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    },
    [active, matches, onClose, onSelect],
  )

  // Listen on the document: the composer keeps focus while the picker is open,
  // so the keystrokes never reach a handler on the list itself.
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (matches.length === 0) return null

  return (
    <div
      ref={listRef}
      data-testid="mention-picker"
      role="listbox"
      aria-label="Mention context"
      className={cn(
        'absolute bottom-full left-0 z-40 mb-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg',
        className,
      )}
    >
      {matches.map((mention, index) => {
        const Icon = KIND_ICON[mention.kind]
        return (
          <button
            key={mention.id}
            type="button"
            role="option"
            aria-selected={index === active}
            data-active={index === active}
            onMouseEnter={() => setActive(index)}
            // mousedown, not click: the textarea would blur first otherwise.
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(mention)
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
              index === active ? 'bg-accent text-accent-foreground' : 'text-foreground',
            )}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono">{mention.label}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
              {KIND_LABEL[mention.kind]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Find the `@` token the caret is inside, if any.
 *
 * Returns the query text and the offset of the `@` so the caller can replace
 * exactly that span when a mention is chosen.
 */
export function findMentionQuery(
  value: string,
  caret: number,
): { query: string; start: number } | null {
  const before = value.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  // `@` must start a word, so an email address doesn't open the picker.
  if (at > 0 && !/[\s(]/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  // A space ends the token — `@foo bar` is no longer a mention.
  if (/[\s]/.test(query)) return null
  return { query, start: at }
}
