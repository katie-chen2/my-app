/**
 * The app's home: a two-pane coding workspace.
 *
 * Left — a chat with the app's own AI agent (`/api/ai/*`, billed to the
 * signed-in user's DeepSpace credits). Right — a code editor. Every message
 * carries the current editor buffer, so the agent always answers about the
 * code on screen, and any fenced block it returns can be applied back into the
 * editor with one click.
 *
 * Sign-in is required: the agent routes reject anonymous callers with 401, and
 * credits are per-account.
 */

import { useCallback, useState } from 'react'
import { useAuthProfileReady } from 'deepspace'
import { Code2, LogIn } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { AgentChat } from '@/components/workspace/AgentChat'
import { CodeEditor, STARTER_CODE, type Language } from '@/components/workspace/CodeEditor'
import { APP_NAME } from '@/constants'

export default function HomePage() {
  const { isLoaded, isSignedIn, user } = useAuthProfileReady({ requireUser: true })

  const [code, setCode] = useState(STARTER_CODE)
  const [language, setLanguage] = useState<Language>('typescript')
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)

  const applyCode = useCallback((next: string) => {
    setCode(next)
  }, [])

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
            Chat with the agent on the left, edit code on the right.
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
          onApplyCode={applyCode}
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
          className="min-h-[60vh] lg:min-h-0"
        />
      </div>
    </div>
  )
}
