/**
 * The floating toolbar that appears over a text selection in the editor.
 *
 * Positioned from the textarea's own geometry: a `<textarea>` cannot report
 * where a selection is on screen, so the caret is measured with a hidden mirror
 * element that copies the textarea's font metrics and wraps the text up to the
 * selection start. That gives a real (x, y) for the toolbar without pulling in
 * an editor library.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { BookOpen, Sparkles, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

export type SelectionAction = 'ask' | 'refactor' | 'explain'

export interface SelectionToolbarProps {
  /** The textarea the selection lives in. */
  anchor: HTMLTextAreaElement | null
  /** Selection offsets in the textarea's value. */
  start: number
  end: number
  /** The textarea's current value, needed to measure the caret position. */
  value: string
  onAction: (action: SelectionAction) => void
  className?: string
}

const ACTIONS: Array<{ id: SelectionAction; label: string; icon: typeof Wand2 }> = [
  { id: 'ask', label: 'Ask Agent', icon: Sparkles },
  { id: 'refactor', label: 'Refactor', icon: Wand2 },
  { id: 'explain', label: 'Explain', icon: BookOpen },
]

/** Mirror styles that affect where text wraps, copied from the textarea. */
const MIRROR_PROPS = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-transform',
  'word-spacing',
  'tab-size',
] as const

export function SelectionToolbar({
  anchor,
  start,
  end,
  value,
  onAction,
  className,
}: SelectionToolbarProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const measure = useCallback(() => {
    if (!anchor) {
      setPosition(null)
      return
    }

    const rect = anchor.getBoundingClientRect()
    const style = window.getComputedStyle(anchor)

    // A hidden div with the textarea's exact metrics, holding the text up to
    // the selection start plus a marker span. The marker's offset is where the
    // selection begins on screen.
    const mirror = document.createElement('div')
    for (const prop of MIRROR_PROPS) {
      mirror.style.setProperty(prop, style.getPropertyValue(prop))
    }
    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordWrap = 'break-word'
    mirror.style.overflowWrap = 'break-word'
    mirror.style.top = '0'
    mirror.style.left = '0'

    mirror.textContent = value.slice(0, start)
    const marker = document.createElement('span')
    marker.textContent = value.slice(start, end) || '\u200b'
    mirror.appendChild(marker)

    document.body.appendChild(mirror)
    const markerRect = marker.getBoundingClientRect()
    const mirrorRect = mirror.getBoundingClientRect()
    document.body.removeChild(mirror)

    // Marker position relative to the textarea's content box, then offset by
    // the textarea's own scroll so the toolbar tracks scrolled text.
    const offsetX = markerRect.left - mirrorRect.left
    const offsetY = markerRect.top - mirrorRect.top

    const top = rect.top + offsetY - anchor.scrollTop - 44
    const left = rect.left + offsetX - anchor.scrollLeft

    setPosition({
      top: Math.max(8, top),
      left: Math.min(Math.max(8, left), window.innerWidth - 260),
    })
  }, [anchor, end, start, value])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  // The toolbar is anchored to a screen position, so it has to follow scroll
  // and resize rather than drift away from the text it belongs to.
  useEffect(() => {
    if (!anchor) return
    const handle = () => measure()
    window.addEventListener('scroll', handle, true)
    window.addEventListener('resize', handle)
    anchor.addEventListener('scroll', handle)
    return () => {
      window.removeEventListener('scroll', handle, true)
      window.removeEventListener('resize', handle)
      anchor.removeEventListener('scroll', handle)
    }
  }, [anchor, measure])

  if (!position) return null

  return (
    <div
      data-testid="selection-toolbar"
      role="toolbar"
      aria-label="Selection actions"
      style={{ top: position.top, left: position.left }}
      className={cn(
        'fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-lg',
        className,
      )}
      // Keep the textarea's selection alive: a mousedown on the toolbar would
      // otherwise blur the textarea and collapse it before the click lands.
      onMouseDown={(event) => event.preventDefault()}
    >
      {ACTIONS.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => onAction(id)}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </Button>
      ))}
    </div>
  )
}
