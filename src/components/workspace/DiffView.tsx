/**
 * The review pane: what the agent proposed, as a line diff.
 *
 * The agent returns whole files rather than patches, so the change is derived
 * here (`diff.ts`) and shown hunk by hunk. Nothing reaches the editor until the
 * user accepts — either one hunk at a time or all of them at once — which is
 * what stops a regeneration from silently discarding work the user did by hand.
 */

import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Undo2, X } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import {
  applyHunks,
  buildHunks,
  diffLines,
  diffStats,
  type CodeProposal,
  type DiffLine,
} from './diff'

interface DiffViewProps {
  proposal: CodeProposal
  /** The buffer as it stands now — may have moved on since the proposal. */
  currentCode: string
  /** Apply the accepted hunks. */
  onAccept: (code: string) => void
  /** Discard the proposal and go back to editing. */
  onReject: () => void
  /** Re-diff the proposal against the current buffer. */
  onRebase: () => void
  className?: string
}

export function DiffView({
  proposal,
  currentCode,
  onAccept,
  onReject,
  onRebase,
  className,
}: DiffViewProps) {
  const lines = useMemo(
    () => diffLines(proposal.baseCode, proposal.code),
    [proposal.baseCode, proposal.code],
  )
  const hunks = useMemo(() => buildHunks(lines, 3), [lines])
  const stats = useMemo(() => diffStats(lines), [lines])

  // Every hunk starts accepted: the common case is "take the agent's version",
  // and unchecking one is cheaper than checking all of them.
  const [accepted, setAccepted] = useState<Set<number>>(
    () => new Set(hunks.map((_, index) => index)),
  )
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set())

  // A rebase re-diffs against the live buffer and can change the hunk count, so
  // drop indices that no longer exist rather than counting phantom accepts.
  const validAccepted = useMemo(() => {
    const next = new Set<number>()
    for (const index of accepted) if (index < hunks.length) next.add(index)
    return next
  }, [accepted, hunks.length])

  const stale = currentCode !== proposal.baseCode
  const acceptedCount = validAccepted.size
  const allAccepted = acceptedCount === hunks.length

  const toggleHunk = useCallback((index: number) => {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const toggleCollapsed = useCallback((index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const acceptAll = useCallback(() => {
    onAccept(proposal.code)
  }, [onAccept, proposal.code])

  const acceptSelected = useCallback(() => {
    if (allAccepted) {
      onAccept(proposal.code)
      return
    }
    onAccept(applyHunks(lines, hunks, validAccepted))
  }, [allAccepted, hunks, lines, onAccept, proposal.code, validAccepted])

  if (hunks.length === 0) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6', className)}>
        <p className="text-sm text-muted-foreground">The agent's version matches your editor.</p>
        <Button variant="outline" size="sm" onClick={onReject}>
          Back to editing
        </Button>
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <Badge variant="info" size="sm">
          Agent changes
        </Badge>
        <span className="font-mono text-[11px] text-success">+{stats.added}</span>
        <span className="font-mono text-[11px] text-destructive">−{stats.removed}</span>
        <span className="text-[11px] text-muted-foreground">
          {hunks.length} {hunks.length === 1 ? 'change' : 'changes'}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onReject}>
            <X aria-hidden />
            Reject all
          </Button>
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={acceptSelected}
            disabled={acceptedCount === 0}
          >
            <Check aria-hidden />
            {allAccepted ? 'Accept all' : `Accept ${acceptedCount} of ${hunks.length}`}
          </Button>
        </div>
      </div>

      {stale && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-2 border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p className="flex-1">
            You edited the file after the agent wrote this. Accepting replaces those edits with the
            agent's version of the changed lines.
          </p>
          <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={onRebase}>
            <Undo2 aria-hidden />
            Re-diff against my edits
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-background font-mono text-xs leading-5">
        {hunks.map((hunk, index) => {
          const isAccepted = validAccepted.has(index)
          const isCollapsed = collapsed.has(index)
          return (
            <div
              key={index}
              data-testid="diff-hunk"
              data-accepted={isAccepted}
              className={cn(
                'border-b border-border/60',
                !isAccepted && 'opacity-55',
              )}
            >
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/60 bg-card/95 px-2 py-1 backdrop-blur">
                <button
                  type="button"
                  onClick={() => toggleCollapsed(index)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3" aria-hidden />
                  ) : (
                    <ChevronDown className="size-3" aria-hidden />
                  )}
                  <span>
                    @@ −{hunk.oldStart} +{hunk.newStart} @@
                  </span>
                </button>

                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant={isAccepted ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => toggleHunk(index)}
                    aria-pressed={isAccepted}
                  >
                    {isAccepted ? <Check aria-hidden /> : <X aria-hidden />}
                    {isAccepted ? 'Accepted' : 'Rejected'}
                  </Button>
                </div>
              </div>

              {!isCollapsed && (
                <div>
                  {hunk.lines.map((line, lineIndex) => (
                    <DiffRow key={lineIndex} line={line} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DiffRow({ line }: { line: DiffLine }) {
  const marker = line.op === 'add' ? '+' : line.op === 'remove' ? '−' : ' '

  return (
    <div
      className={cn(
        'flex items-start',
        line.op === 'add' && 'bg-success/10',
        line.op === 'remove' && 'bg-destructive/10',
      )}
    >
      <span className="w-10 shrink-0 select-none pr-2 text-right text-[11px] text-muted-foreground/50">
        {line.oldLine ?? ''}
      </span>
      <span className="w-10 shrink-0 select-none pr-2 text-right text-[11px] text-muted-foreground/50">
        {line.newLine ?? ''}
      </span>
      <span
        className={cn(
          'w-4 shrink-0 select-none text-center',
          line.op === 'add' && 'text-success',
          line.op === 'remove' && 'text-destructive',
          line.op === 'context' && 'text-muted-foreground/40',
        )}
        aria-hidden
      >
        {marker}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 whitespace-pre-wrap break-words pr-3',
          line.op === 'add' && 'text-success',
          line.op === 'remove' && 'text-destructive',
          line.op === 'context' && 'text-foreground/80',
        )}
      >
        {line.text || '\u00a0'}
      </span>
    </div>
  )
}
