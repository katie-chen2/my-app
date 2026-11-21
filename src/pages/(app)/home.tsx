/**
 * The app's home: a two-pane coding workspace.
 *
 * Left — a chat with the app's own AI agent (`/api/ai/*`, billed to the
 * signed-in user's DeepSpace credits). Right — a code editor.
 *
 * Two rules shape the data flow here:
 *
 * 1. **The agent never writes to the buffer.** A fenced block it returns
 *    becomes a *proposal*; the editor renders it as a diff and the user accepts
 *    or rejects it, hunk by hunk. Nothing is overwritten without a decision.
 * 2. **Manual edits are visible to the agent.** `agentBaseline` records the
 *    buffer the agent last saw. At send time the difference between that and
 *    the live buffer is attached to the turn, so the model knows what the user
 *    changed by hand and can preserve it instead of regenerating over it.
 *
 * Sign-in is required: the agent routes reject anonymous callers with 401, and
 * credits are per-account.
 */

import { useCallback, useRef, useState } from 'react'
import { useAuthProfileReady } from 'deepspace'
import { Code2, LogIn } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { AgentChat } from '@/components/workspace/AgentChat'
import { CodeEditor, STARTER_CODE, type Language } from '@/components/workspace/CodeEditor'
import { describeManualEdits, type CodeProposal } from '@/components/workspace/diff'
import { APP_NAME } from '@/constants'

export default function HomePage() {
  const { isLoaded, isSignedIn, user } = useAuthProfileReady({ requireUser: true })

  const [code, setCode] = useState(STARTER_CODE)
  const [language, setLanguage] = useState<Language>('typescript')
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [proposal, setProposal] = useState<CodeProposal | null>(null)

  /**
   * The buffer the agent last saw. Kept in a ref because it is read at send
   * time, not rendered — a state update would re-render the whole page on
   * every turn for no visual change.
   */
  const agentBaseline = useRef(STARTER_CODE)

  /** Hand a fenced block to the editor as a proposal instead of applying it. */
  const proposeCode = useCallback((next: string, nextLanguage?: string) => {
    setProposal({
      id: `proposal-${crypto.randomUUID()}`,
      code: next,
      language: nextLanguage,
      // Diff against what the agent actually saw, not against the live buffer.
      // If the user typed since sending, the diff then shows the agent's change
      // on top of the old text and the review pane warns that accepting would
      // replace those hand edits — which is the honest framing.
      baseCode: agentBaseline.current,
    })
  }, [])

  /** Record what the agent is about to see, so later hand edits are diffable. */
  const handleTurnSent = useCallback((sentCode: string) => {
    agentBaseline.current = sentCode
  }, [])

  /** The user's hand edits since the agent last saw the buffer, as a diff. */
  const getManualEdits = useCallback(
    () => describeManualEdits(agentBaseline.current, code),
    [code],
  )

  const acceptProposal = useCallback(
    (next: string) => {
      // A full accept means the buffer is now exactly what the agent wrote, so
      // the agent has already seen it — move the baseline forward and the next
      // turn won't re-report it as a manual edit. A partial accept produces a
      // mix the agent has never seen, so the baseline stays put and the diff
      // describes it.
      if (proposal && next === proposal.code) agentBaseline.current = next
      setCode(next)
      setProposal(null)
    },
    [proposal],
  )

  const rejectProposal = useCallback(() => {
    setProposal(null)
  }, [])

  /**
   * Re-diff the pending proposal against the buffer as it stands now, so the
   * user's hand edits become the "before" side and only the agent's remaining
   * changes show up as additions.
   */
  const rebaseProposal = useCallback(() => {
    setProposal((prev) => (prev ? { ...prev, baseCode: code } : prev))
  }, [code])

  const askAboutCode = useCallback(() => {
    setDraft('Review this code and suggest improvements.')
  }, [])

  if (!isLoaded) {
    return <div aria-busy="true" className="h-full bg-background" />
  }

  if (!isSignedIn || !user) {
    return (
      <div className="flex h-full items-center justify-center bg-background px-6">
        <EmptyState
          icon={<LogIn aria-hidden />}
          title={`Sign in to use ${APP_NAME}`}
          description="The coding agent runs on your DeepSpace credits, so it needs an account. Sign in from the top bar to open the workspace."
          className="max-w-md"
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <Code2 className="size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">Coding workspace</h1>
          <p className="truncate text-xs text-muted-foreground">
            Chat with the agent on the left, review its changes on the right.
          </p>
        </div>
      </header>

      {/* Stacked on narrow screens (the page scrolls); side by side from lg up,
          where each pane owns its own scroll area. */}
      <div className="flex flex-col divide-y divide-border lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <AgentChat
          userId={user.id}
          credits={user.credits?.total}
          draft={draft}
          onDraftChange={setDraft}
          code={code}
          language={language}
          onProposeCode={proposeCode}
          getManualEdits={getManualEdits}
          onTurnSent={handleTurnSent}
          onStreamingChange={setStreaming}
          className="min-h-[70vh] lg:min-h-0"
        />
        <CodeEditor
          value={code}
          onChange={setCode}
          language={language}
          onLanguageChange={setLanguage}
          busy={streaming}
          onAskAgent={askAboutCode}
          proposal={proposal}
          onAcceptProposal={acceptProposal}
          onRejectProposal={rejectProposal}
          onRebaseProposal={rebaseProposal}
          className="min-h-[60vh] lg:min-h-0"
        />
      </div>
    </div>
  )
}
