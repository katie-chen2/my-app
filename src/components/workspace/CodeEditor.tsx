/**
 * A dependency-free code editor pane.
 *
 * A `<textarea>` with a synced line-number gutter, tab-to-indent, and a
 * language picker. Deliberately not Monaco/CodeMirror: the app ships no editor
 * package, and a plain textarea keeps the bundle small while still supporting
 * the workflow this page needs (paste code, let the agent rewrite it, copy it
 * back out).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, FileCode2, GitCompareArrows, RotateCcw, Wand2 } from 'lucide-react'
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { DiffView } from './DiffView'
import { SelectionToolbar, type SelectionAction } from './SelectionToolbar'
import type { CodeProposal } from './diff'
import { lineRangeFor, type SelectionContext } from './mentions'

export const LANGUAGES = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'tsx', label: 'TSX' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'sql', label: 'SQL' },
  { value: 'json', label: 'JSON' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'plaintext', label: 'Plain text' },
] as const

export type Language = (typeof LANGUAGES)[number]['value']

const STARTER_CODE = `// Paste code here, or ask the agent to write some.
// The agent sees this buffer with every message you send.

export function greet(name: string): string {
  return \`Hello, \${name}!\`
}
`

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: Language
  onLanguageChange: (language: Language) => void
  /**
   * A turn is streaming. The editor stays editable — the snapshot sent to the
   * model was captured when the message was sent — but the "Review" shortcut
   * is disabled so it can't queue a second turn.
   */
  busy?: boolean
  /** Called when the user asks the agent to review the current buffer. */
  onAskAgent: () => void
  /**
   * A change the agent proposed, awaiting the user's decision. While this is
   * set the pane shows a diff instead of the textarea — the buffer is never
   * overwritten without an explicit accept.
   */
  proposal?: CodeProposal | null
  onAcceptProposal?: (code: string) => void
  onRejectProposal?: () => void
  /** Re-diff the pending proposal against the buffer as it stands now. */
  onRebaseProposal?: () => void
  /**
   * The user picked an action from the selection toolbar. The page turns this
   * into a mention in the composer, so the selection travels with the message.
   */
  onSelectionAction?: (action: SelectionAction, selection: SelectionContext) => void
  /** Name shown in the selection payload, e.g. `main.ts`. */
  fileName?: string
  className?: string
}

export function CodeEditor({
  value,
  onChange,
  language,
  onLanguageChange,
  busy = false,
  onAskAgent,
  proposal = null,
  onAcceptProposal,
  onRejectProposal,
  onRebaseProposal,
  onSelectionAction,
  fileName = 'editor',
  className,
}: CodeEditorProps) {
  const { success } = useToast()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)

  const lineCount = useMemo(() => value.split('\n').length, [value])
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1),
    [lineCount],
  )

  // Keep the gutter aligned with the textarea's own scroll position.
  const syncScroll = useCallback(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      success('Copied', 'Editor contents are on your clipboard.')
    } catch {
      // Clipboard access can be denied; the textarea is still selectable.
    }
  }, [success, value])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Tab') return
      event.preventDefault()
      const target = event.currentTarget
      const { selectionStart, selectionEnd } = target
      const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`
      onChange(next)
      // Restore the caret after React re-renders with the new value.
      requestAnimationFrame(() => {
        target.selectionStart = selectionStart + 2
        target.selectionEnd = selectionStart + 2
      })
    },
    [onChange, value],
  )

  /**
   * Read the textarea's selection into state. Called on every interaction that
   * can move it — mouse, keyboard, and programmatic changes — because a
   * textarea fires no event for "the selection changed".
   */
  const syncSelection = useCallback(() => {
    const target = textareaRef.current
    if (!target) return
    const { selectionStart, selectionEnd } = target
    if (selectionStart === selectionEnd) {
      setSelection(null)
      return
    }
    setSelection({ start: selectionStart, end: selectionEnd })
  }, [])

  const handleSelectionAction = useCallback(
    (action: SelectionAction) => {
      if (!selection || !onSelectionAction) return
      const text = value.slice(selection.start, selection.end)
      if (!text.trim()) return
      const { startLine, endLine } = lineRangeFor(value, selection.start, selection.end)
      onSelectionAction(action, { text, startLine, endLine, fileName, language })
      setSelection(null)
    },
    [fileName, language, onSelectionAction, selection, value],
  )

  return (
    <section
      data-testid="code-editor"
      aria-label="Code editor"
      className={cn('flex min-h-0 flex-col bg-background', className)}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium text-foreground">Editor</h2>
        {proposal ? (
          <Badge variant="info" size="sm" data-testid="editor-review-badge">
            <GitCompareArrows className="mr-1 size-3" aria-hidden />
            Reviewing
          </Badge>
        ) : (
          <Badge variant="secondary" size="sm">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Select value={language} onValueChange={(next) => onLanguageChange(next as Language)}>
            <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Editor language">
              <SelectValue placeholder="Language" />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {proposal ? (
            <Button variant="outline" size="sm" onClick={onRejectProposal}>
              Back to editor
            </Button>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onAskAgent}
                      disabled={busy || !value.trim()}
                    >
                      <Wand2 aria-hidden />
                      Review
                    </Button>
                  }
                />
                <TooltipContent>Ask the agent to review this code</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={handleCopy}
                      aria-label="Copy code"
                    >
                      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    </Button>
                  }
                />
                <TooltipContent>Copy to clipboard</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => onChange(STARTER_CODE)}
                      aria-label="Reset editor"
                    >
                      <RotateCcw aria-hidden />
                    </Button>
                  }
                />
                <TooltipContent>Reset to the starter snippet</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </header>

      {proposal ? (
        <DiffView
          key={proposal.id}
          proposal={proposal}
          currentCode={value}
          onAccept={(next) => onAcceptProposal?.(next)}
          onReject={() => onRejectProposal?.()}
          onRebase={() => onRebaseProposal?.()}
        />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div
            ref={gutterRef}
            aria-hidden
            className="w-12 shrink-0 select-none overflow-hidden border-r border-border bg-card/40 py-3 text-right font-mono text-xs leading-6 text-muted-foreground/60"
          >
            {lineNumbers.map((line) => (
              <div key={line} className="pr-2">
                {line}
              </div>
            ))}
          </div>

          <textarea
            ref={textareaRef}
            data-testid="code-editor-input"
            aria-label="Code"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            onSelect={syncSelection}
            onMouseUp={syncSelection}
            onKeyUp={syncSelection}
            onBlur={() => setSelection(null)}
            placeholder="Paste code here…"
            className="min-h-0 flex-1 resize-none bg-transparent px-3 py-3 font-mono text-xs leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      )}

      {selection && !proposal && onSelectionAction && (
        <SelectionToolbar
          anchor={textareaRef.current}
          start={selection.start}
          end={selection.end}
          value={value}
          onAction={handleSelectionAction}
        />
      )}
    </section>
  )
}

export { STARTER_CODE }
