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
import { Check, Copy, FileCode2, RotateCcw, Wand2 } from 'lucide-react'
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
  className?: string
}

export function CodeEditor({
  value,
  onChange,
  language,
  onLanguageChange,
  busy = false,
  onAskAgent,
  className,
}: CodeEditorProps) {
  const { success } = useToast()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

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

  return (
    <section
      data-testid="code-editor"
      aria-label="Code editor"
      className={cn('flex min-h-0 flex-col bg-background', className)}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium text-foreground">Editor</h2>
        <Badge variant="secondary" size="sm">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </Badge>

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
        </div>
      </header>

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
          placeholder="Paste code here…"
          className="min-h-0 flex-1 resize-none bg-transparent px-3 py-3 font-mono text-xs leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
        />
      </div>
    </section>
  )
}

export { STARTER_CODE }
