/**
 * Thin client for the app's AI chat routes (`src/ai/chat-routes.ts`).
 *
 * The worker streams Vercel AI SDK 7 `UIMessageChunk` events over SSE. Rather
 * than pulling in `@ai-sdk/react`, we decode the wire format with the SDK's
 * own helpers (`parseSseLine` + `decodeAiStreamChunk`) so the action vocabulary
 * stays in lockstep with the server.
 */

import { decodeAiStreamChunk, getAuthToken, parseSseLine, type AiStreamAction } from 'deepspace'

/**
 * Marks the boundary between what the user typed and the editor snapshot we
 * append for the model. The UI strips everything from here on when rendering
 * the user's bubble, so the transcript stays readable while the model still
 * sees the code it is being asked to change.
 */
export const EDITOR_CONTEXT_MARKER = '<<<EDITOR_CONTEXT>>>'

/** Compose the wire payload: the user's words plus the current editor buffer. */
export function composeUserContent(message: string, code: string, language: string): string {
  if (!code.trim()) return message
  return [
    message,
    '',
    EDITOR_CONTEXT_MARKER,
    `The user's current editor content (${language}):`,
    '```' + language,
    code,
    '```',
  ].join('\n')
}

/** Split a persisted user message back into display text + context flag. */
export function splitUserContent(content: string): { message: string; hasContext: boolean } {
  const index = content.indexOf(EDITOR_CONTEXT_MARKER)
  if (index === -1) return { message: content, hasContext: false }
  return { message: content.slice(0, index).trimEnd(), hasContext: true }
}

/** A failed chat request, carrying the fields the UI needs to explain itself. */
export class ChatRequestError extends Error {
  readonly status: number
  readonly code?: string
  readonly availableCredits?: number
  readonly requiredCredits?: number

  constructor(
    message: string,
    init: {
      status: number
      code?: string
      availableCredits?: number
      requiredCredits?: number
    },
  ) {
    super(message)
    this.name = 'ChatRequestError'
    this.status = init.status
    this.code = init.code
    this.availableCredits = init.availableCredits
    this.requiredCredits = init.requiredCredits
  }

  /** True when the turn was refused because the account is out of credits. */
  get isInsufficientCredits(): boolean {
    return this.status === 402 || this.code === 'insufficient_credits'
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken()
  if (!token) {
    throw new ChatRequestError('Sign in to talk to the agent.', { status: 401 })
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

async function toRequestError(res: Response): Promise<ChatRequestError> {
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    // Non-JSON error body (proxy HTML, empty 5xx) — fall through to status text.
  }
  const message =
    typeof body.message === 'string'
      ? body.message
      : typeof body.error === 'string'
        ? body.error
        : `Request failed (${res.status})`
  return new ChatRequestError(message, {
    status: res.status,
    code: typeof body.error === 'string' ? body.error : undefined,
    availableCredits:
      typeof body.availableCredits === 'number' ? body.availableCredits : undefined,
    requiredCredits: typeof body.requiredCredits === 'number' ? body.requiredCredits : undefined,
  })
}

/** Create a chat row owned by the caller and return its record id. */
export async function createChat(title = 'New chat'): Promise<string> {
  const res = await fetch('/api/ai/chats', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw await toRequestError(res)
  const body = (await res.json()) as { chat?: { recordId?: string } }
  const chatId = body.chat?.recordId
  if (!chatId) {
    throw new ChatRequestError('The server did not return a chat id.', { status: 500 })
  }
  return chatId
}

/** Delete a chat and its messages. */
export async function deleteChat(chatId: string): Promise<void> {
  const res = await fetch(`/api/ai/chats/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  if (!res.ok) throw await toRequestError(res)
}

export interface StreamTurnOptions {
  chatId: string
  /**
   * Client-generated id for the user turn. The worker persists the row under
   * exactly this id, so the local optimistic bubble is replaced by the
   * persisted one instead of appearing twice.
   */
  userMessageId: string
  content: string
  modelId?: string
  signal?: AbortSignal
  /** Fires once with the server-allocated assistant row id (`X-Asst-Id`). */
  onAssistantId?: (assistantId: string) => void
  onAction: (action: AiStreamAction) => void
}

/**
 * Send one turn and pump the SSE stream until it closes.
 *
 * Resolves when the stream ends normally; throws `ChatRequestError` for a
 * rejected request and `AbortError` when `signal` is aborted.
 */
export async function streamTurn({
  chatId,
  userMessageId,
  content,
  modelId,
  signal,
  onAssistantId,
  onAction,
}: StreamTurnOptions): Promise<void> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      chatId,
      userMessageId,
      content,
      ...(modelId ? { modelId } : {}),
    }),
    signal,
  })
  if (!res.ok) throw await toRequestError(res)

  const assistantId = res.headers.get('X-Asst-Id')
  if (assistantId) onAssistantId?.(assistantId)

  if (!res.body) {
    throw new ChatRequestError('The response had no body.', { status: 500 })
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const chunk = parseSseLine(line)
      if (!chunk) continue
      const action = decodeAiStreamChunk(chunk)
      if (action) onAction(action)
    }
  }
}
