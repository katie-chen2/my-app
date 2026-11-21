/**
 * The agent side of the workspace: a streaming chat against the app's own
 * `/api/ai/*` routes, with a credit meter and a model picker.
 *
 * Persisted turns come from `useQuery('ai-messages')` (the worker writes them
 * on completion and the RecordRoom broadcasts them). In-flight turns live in
 * local state and are dropped as soon as their persisted row arrives, so the
 * transcript never double-renders a message.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listDeepSpaceAgentModels, useQuery } from 'deepspace'
import { AlertTriangle, ArrowUp, AtSign, Coins, Loader2, Plus, Sparkles, Square, Trash2, X } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import {
  ChatRequestError,
  composeUserContent,
  createChat,
  deleteChat,
  splitUserContent,
  streamTurn,
} from './chat-client'
import { MentionPicker, findMentionQuery } from './MentionPicker'
import type { Mention } from './mentions'

interface AiMessageData {
  chatId: string
  userId: string
  role: 'user' | 'assistant'
  content: string
}

interface AiChatData {
  userId: string
  title?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** True while tokens are still arriving for this message. */
  streaming?: boolean
  /** Set when the turn failed; rendered inline instead of the text. */
  error?: string
}

const MODELS = listDeepSpaceAgentModels('application')
const DEFAULT_MODEL_ID = MODELS[0]?.id ?? ''

/** Sentinel that matches no row, so the query is inert before a chat exists. */
const NO_CHAT = '__no_chat__'

type Segment =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string; lang: string }

/** Split assistant markdown into prose and fenced code blocks. */
function parseSegments(content: string): Segment[] {
  const segments: Segment[] = []
  const fence = /```([\w+#.-]*)\r?\n([\s\S]*?)```/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = fence.exec(content)) !== null) {
    if (match.index > last) {
      const text = content.slice(last, match.index)
      if (text.trim()) segments.push({ type: 'text', value: text })
    }
    segments.push({
      type: 'code',
      value: match[2].replace(/\n$/, ''),
      lang: match[1] || 'text',
    })
    last = match.index + match[0].length
  }

  if (last < content.length) {
    const text = content.slice(last)
    if (text.trim()) segments.push({ type: 'text', value: text })
  }

  return segments
}

interface AgentChatProps {
  userId: string
  /** Credits left on the account, or `undefined` while the profile loads. */
  credits: number | undefined
  draft: string
  onDraftChange: (value: string) => void
  /** Current editor buffer, sent along with every message. */
  code: string
  language: string
  /**
   * Hand a fenced code block to the editor as a *proposal* — the editor shows
   * it as a diff and the user decides what to keep. Never writes directly.
   */
  onProposeCode: (code: string, language?: string) => void
  /**
   * Returns a diff of the user's hand edits since the agent last saw the
   * buffer, or null when there are none. Called at send time so the diff is
   * computed once per turn rather than on every keystroke.
   */
  getManualEdits: () => string | null
  /** Fires when a turn is sent, with the buffer the agent is about to see. */
  onTurnSent: (code: string) => void
  onStreamingChange: (streaming: boolean) => void
  /**
   * Context the user pointed at with `@`, or that the editor handed over from
   * its selection toolbar. Cleared by the page once the turn is sent.
   */
  mentions: Mention[]
  onMentionsChange: (mentions: Mention[]) => void
  /** Everything the `@` picker can offer right now. */
  mentionOptions: Mention[]
  className?: string
}

export function AgentChat({
  userId,
  credits,
  draft,
  onDraftChange,
  code,
  language,
  onProposeCode,
  getManualEdits,
  onTurnSent,
  onStreamingChange,
  mentions,
  onMentionsChange,
  mentionOptions,
  className,
}: AgentChatProps) {
  const { error: toastError, success } = useToast()

  const [chatId, setChatId] = useState<string | null>(null)
  const [resumeChecked, setResumeChecked] = useState(false)
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID)
  const [local, setLocal] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<{ query: string; start: number } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastSentRef = useRef<string>('')

  const { records: chats, status: chatsStatus } = useQuery<AiChatData>('ai-chats', {
    where: { userId },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 1,
  })

  const { records: persisted } = useQuery<AiMessageData>('ai-messages', {
    where: { chatId: chatId ?? NO_CHAT, userId },
    orderBy: 'createdAt',
    orderDir: 'asc',
  })

  // Resume the most recent conversation once, so a reload doesn't strand the
  // history behind a brand-new empty chat.
  useEffect(() => {
    if (resumeChecked || chatId) return
    if (chatsStatus !== 'ready') return
    setResumeChecked(true)
    const latest = chats[0]
    if (latest) setChatId(latest.recordId)
  }, [chatId, chats, chatsStatus, resumeChecked])

  // Drop local copies of messages the worker has now persisted.
  useEffect(() => {
    const ids = new Set(persisted.map((record) => record.recordId))
    setLocal((prev) => {
      const next = prev.filter((message) => !ids.has(message.id))
      return next.length === prev.length ? prev : next
    })
  }, [persisted])

  const messages = useMemo<ChatMessage[]>(() => {
    const stored = persisted.map<ChatMessage>((record) => ({
      id: record.recordId,
      role: record.data.role,
      content: record.data.content,
    }))
    return [...stored, ...local]
  }, [local, persisted])

  // Follow the tail of the transcript as tokens arrive.
  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages])

  useEffect(() => {
    onStreamingChange(streaming)
  }, [onStreamingChange, streaming])

  // Abort an in-flight turn if the page unmounts.
  useEffect(() => () => abortRef.current?.abort(), [])

  const patchAssistant = useCallback((id: string, patch: (message: ChatMessage) => ChatMessage) => {
    setLocal((prev) => prev.map((message) => (message.id === id ? patch(message) : message)))
  }, [])

  const send = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim()
      if (!message || streaming) return

      setFailure(null)
      onDraftChange('')
      lastSentRef.current = message

      const content = composeUserContent(
        message,
        code,
        language,
        getManualEdits(),
        mentions.map((mention) => mention.payload),
      )
      onMentionsChange([])
      onTurnSent(code)
      const userMessageId = `umsg-${crypto.randomUUID()}`
      const assistantPlaceholderId = `local-asst-${crypto.randomUUID()}`

      setLocal((prev) => [
        ...prev,
        { id: userMessageId, role: 'user', content },
        { id: assistantPlaceholderId, role: 'assistant', content: '', streaming: true },
      ])
      setStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      let assistantId = assistantPlaceholderId

      try {
        let activeChatId = chatId
        if (!activeChatId) {
          activeChatId = await createChat()
          setChatId(activeChatId)
        }

        await streamTurn({
          chatId: activeChatId,
          userMessageId,
          content,
          modelId: modelId || undefined,
          signal: controller.signal,
          onAssistantId: (id) => {
            // Re-key the placeholder to the server's row id so the persisted
            // row replaces it instead of appearing twice.
            assistantId = id
            setLocal((prev) =>
              prev.map((entry) =>
                entry.id === assistantPlaceholderId ? { ...entry, id } : entry,
              ),
            )
          },
          onAction: (action) => {
            switch (action.type) {
              case 'append-text':
                patchAssistant(assistantId, (entry) => ({
                  ...entry,
                  content: entry.content + action.delta,
                }))
                break
              case 'stream-error':
                patchAssistant(assistantId, (entry) => ({
                  ...entry,
                  streaming: false,
                  error: action.errorText,
                }))
                break
              case 'abort':
                patchAssistant(assistantId, (entry) => ({ ...entry, streaming: false }))
                break
              default:
                // Tool-call actions are not surfaced in this pane; the agent's
                // prose already describes what it did.
                break
            }
          },
        })

        patchAssistant(assistantId, (entry) => ({ ...entry, streaming: false }))
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError'
        if (aborted) {
          // Keep whatever text arrived; drop an empty bubble.
          setLocal((prev) =>
            prev.filter((entry) => entry.id !== assistantId || entry.content.trim() !== ''),
          )
          setLocal((prev) =>
            prev.map((entry) =>
              entry.id === assistantId ? { ...entry, streaming: false } : entry,
            ),
          )
        } else {
          const requestError =
            error instanceof ChatRequestError
              ? error
              : new ChatRequestError(
                  error instanceof Error ? error.message : 'The agent request failed.',
                  { status: 0 },
                )
          setLocal((prev) => prev.filter((entry) => entry.id !== assistantId))
          setFailure(requestError.message)
          if (requestError.isInsufficientCredits) {
            toastError(
              'Out of credits',
              requestError.availableCredits !== undefined &&
                requestError.requiredCredits !== undefined
                ? `You have ${requestError.availableCredits} credits; this turn needs ${requestError.requiredCredits}.`
                : 'Top up your credits to keep chatting with the agent.',
            )
          } else {
            toastError('Agent request failed', requestError.message)
          }
        }
      } finally {
        abortRef.current = null
        setStreaming(false)
      }
    },
    [
      chatId,
      code,
      getManualEdits,
      language,
      mentions,
      modelId,
      onDraftChange,
      onMentionsChange,
      onTurnSent,
      patchAssistant,
      streaming,
      toastError,
    ],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const startNewChat = useCallback(async () => {
    abortRef.current?.abort()
    setLocal([])
    setFailure(null)
    setResumeChecked(true)
    setChatId(null)
    onDraftChange('')
  }, [onDraftChange])

  const removeChat = useCallback(async () => {
    if (!chatId) return
    abortRef.current?.abort()
    try {
      await deleteChat(chatId)
      setLocal([])
      setFailure(null)
      setChatId(null)
      setResumeChecked(true)
      success('Chat deleted', 'The conversation and its messages are gone.')
    } catch (error) {
      toastError(
        'Could not delete the chat',
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }, [chatId, success, toastError])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // The picker stops propagation for the keys it owns, so anything that
      // reaches here is a normal composer keystroke.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void send(draft)
      }
    },
    [draft, send],
  )

  /**
   * Track the `@` token under the caret so the picker can open, filter, and
   * close as the user types.
   */
  const syncMentionQuery = useCallback(
    (value: string, caret: number) => {
      setMentionQuery(findMentionQuery(value, caret))
    },
    [],
  )

  const handleDraftChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value
      onDraftChange(value)
      syncMentionQuery(value, event.target.selectionStart)
    },
    [onDraftChange, syncMentionQuery],
  )

  /** Replace the `@query` span with the mention's token and keep the payload. */
  const insertMention = useCallback(
    (mention: Mention) => {
      const caret = inputRef.current?.selectionStart ?? draft.length
      const span = mentionQuery ?? findMentionQuery(draft, caret)
      const start = span?.start ?? caret
      const end = caret
      const next = `${draft.slice(0, start)}${mention.token} ${draft.slice(end)}`
      onDraftChange(next)
      onMentionsChange([...mentions, mention])
      setMentionQuery(null)

      // Put the caret after the inserted token once React has re-rendered.
      const caretAfter = start + mention.token.length + 1
      requestAnimationFrame(() => {
        const node = inputRef.current
        if (!node) return
        node.focus()
        node.selectionStart = caretAfter
        node.selectionEnd = caretAfter
      })
    },
    [draft, mentionQuery, mentions, onDraftChange, onMentionsChange],
  )

  const removeMention = useCallback(
    (id: string) => {
      onMentionsChange(mentions.filter((mention) => mention.id !== id))
    },
    [mentions, onMentionsChange],
  )

  const outOfCredits = credits !== undefined && credits <= 0
  const canSend = draft.trim().length > 0 && !streaming && !outOfCredits

  return (
    <section
      data-testid="agent-chat"
      aria-label="Agent chat"
      className={cn('flex min-h-0 flex-col bg-background', className)}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium text-foreground">Agent</h2>

        <Badge
          variant={outOfCredits ? 'destructive' : 'secondary'}
          size="sm"
          data-testid="agent-credits"
        >
          <Coins className="mr-1 size-3" aria-hidden />
          {credits === undefined ? '—' : `${credits} credits`}
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          <Select value={modelId} onValueChange={setModelId}>
            <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Model">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={startNewChat}
                  aria-label="New chat"
                >
                  <Plus aria-hidden />
                </Button>
              }
            />
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={removeChat}
                  disabled={!chatId}
                  aria-label="Delete chat"
                >
                  <Trash2 aria-hidden />
                </Button>
              }
            />
            <TooltipContent>Delete this chat</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div
        ref={scrollRef}
        data-testid="agent-chat-transcript"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        {messages.length === 0 ? (
          <EmptyState
            icon={<Sparkles aria-hidden />}
            title="Ask the agent to change your code"
            description="Describe what you want — refactor a function, fix a bug, add a test. The editor contents are sent with every message."
            className="py-10"
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                onProposeCode={onProposeCode}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Announced once per state change rather than per token — an aria-live
          transcript would read every streamed delta aloud. */}
      <p role="status" aria-live="polite" className="sr-only">
        {streaming ? 'The agent is responding.' : failure ? 'The agent could not answer.' : ''}
      </p>

      {failure && (
        <div
          role="alert"
          className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div className="flex-1">
            <p className="font-medium">The agent could not answer.</p>
            <p className="mt-0.5 opacity-90">{failure}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => void send(lastSentRef.current)}
            disabled={streaming}
          >
            Retry
          </Button>
        </div>
      )}

      <div className="border-t border-border p-3">
        {mentions.length > 0 && (
          <ul data-testid="agent-mentions" className="mb-2 flex flex-wrap gap-1.5">
            {mentions.map((mention) => (
              <li key={mention.id}>
                <Badge variant="secondary" size="sm" className="gap-1 pr-1 font-mono">
                  {mention.token}
                  <button
                    type="button"
                    onClick={() => removeMention(mention.id)}
                    aria-label={`Remove ${mention.label}`}
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="relative flex items-end gap-2">
          {mentionQuery && (
            <MentionPicker
              options={mentionOptions}
              query={mentionQuery.query}
              onSelect={insertMention}
              onClose={() => setMentionQuery(null)}
            />
          )}
          <Textarea
            ref={inputRef}
            data-testid="agent-chat-input"
            aria-label="Message the agent"
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            onKeyUp={(event) =>
              syncMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onClick={(event) =>
              syncMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onBlur={() => setMentionQuery(null)}
            placeholder={
              outOfCredits
                ? 'You are out of credits — top up to keep chatting.'
                : 'Ask the agent to refactor, fix, or explain your code…  Type @ for context'
            }
            rows={3}
            disabled={outOfCredits}
            className="min-h-[76px] resize-none font-sans text-sm"
          />
          {streaming ? (
            <Button
              variant="outline"
              size="icon"
              onClick={stop}
              aria-label="Stop generating"
              className="shrink-0"
            >
              <Square aria-hidden />
            </Button>
          ) : (
            <Button
              data-testid="agent-chat-send"
              size="icon"
              onClick={() => void send(draft)}
              disabled={!canSend}
              aria-label="Send message"
              className="shrink-0"
            >
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Enter to send · Shift+Enter for a new line · <AtSign className="inline size-3" aria-hidden />{' '}
          for context · each turn spends credits
        </p>
      </div>
    </section>
  )
}

function MessageRow({
  message,
  onProposeCode,
}: {
  message: ChatMessage
  onProposeCode: (code: string, language?: string) => void
}) {
  const isUser = message.role === 'user'
  const display = isUser ? splitUserContent(message.content) : null
  const segments = isUser ? [] : parseSegments(message.content)

  return (
    <li
      data-testid="agent-chat-message"
      data-role={message.role}
      className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}
    >
      <span className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {isUser ? 'You' : 'Agent'}
      </span>

      <div
        className={cn(
          'max-w-full rounded-xl px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-card text-card-foreground',
        )}
      >
        {isUser ? (
          <>
            <p className="whitespace-pre-wrap break-words">{display?.message}</p>
            {display?.hasContext && (
              <p className="mt-1 text-[11px] opacity-70">Sent with the current editor contents</p>
            )}
          </>
        ) : message.error ? (
          <p className="whitespace-pre-wrap break-words text-destructive">{message.error}</p>
        ) : message.content.trim() === '' ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Thinking…
          </span>
        ) : (
          <div className="flex flex-col gap-2">
            {segments.map((segment, index) =>
              segment.type === 'text' ? (
                <p key={index} className="whitespace-pre-wrap break-words">
                  {segment.value.trim()}
                </p>
              ) : (
                <div key={index} className="overflow-hidden rounded-lg border border-border">
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-2 py-1">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {segment.lang}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => onProposeCode(segment.value, segment.lang)}
                    >
                      Review changes
                    </Button>
                  </div>
                  <pre className="max-h-72 overflow-auto bg-background px-2 py-2 font-mono text-[11px] leading-5">
                    <code>{segment.value}</code>
                  </pre>
                </div>
              ),
            )}
            {message.streaming && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Streaming…
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
