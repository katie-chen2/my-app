# code-workspace

A two-pane AI coding workspace: chat with an agent on the left, edit code on the right. The agent never overwrites your buffer — its changes arrive as a **diff** you accept or reject hunk by hunk.

Built on the [`deepspace`](https://www.npmjs.com/package/deepspace) SDK and deployed to Cloudflare Workers. Live at <https://code-workspace.app.space>.

## Features

**Diff review.** Every fenced block the agent returns gets a *Review changes* button. The editor switches to a diff view with per-hunk Accept/Reject, `+N / −M` stats, and accept-all/reject-all.

**Manual-edit awareness.** `agentBaseline` records the buffer the agent last saw. If you edit while waiting for a reply, the next turn carries a diff of your hand edits so the model preserves them. The diff view detects the same drift and offers *Re-diff against my edits*.

**Selection toolbar.** Select code to raise a floating toolbar — *Ask Agent*, *Refactor*, *Explain*. Each packages the selection text, its line numbers, and the file name into a mention and drops a matching prompt into the composer.

**`@` mentions.** Type `@` in the composer to attach context:

| Token | Attaches |
| --- | --- |
| `@editor.ts` | the whole file |
| `@selection` | the current selection, with line numbers |
| `@greet` | any symbol in the buffer (TS, Python, Go, Rust) |
| `@error` | pasted terminal output |

Arrow keys navigate, `Enter`/`Tab` inserts, `Esc` dismisses. Accepted mentions render as removable chips.

Each mention carries a short `token` (what stays in the message) and a `payload` (full text plus line numbers, appended behind a `<<<MENTION_CONTEXT>>>` marker). The transcript stays readable; the model gets the full context.

**Also:** 12 language modes, synced line-number gutter, model picker, chat history resume, credit metering, interruptible streaming.

## Running it

Requires Node `>=22.15.0 <23 || >=24 <25 || >=26 <27` and npm `>=11.6.0`.

```sh
npm install
npx deepspace auth login   # authenticate with app.space
npx deepspace dev start               # vite + miniflare on http://localhost:5173
npx deepspace deploy            # ship to <name>.app.space
```

Commit before deploying — a release records the current commit and refuses a dirty worktree.

## Commands

| Command | |
| --- | --- |
| `npm run dev` | local dev server |
| `npm run build` | production build |
| `npm run deploy` | deploy to Cloudflare Workers |
| `npm run validate` | type-check + unit tests (run before committing) |
| `npm run lint` | ESLint |
| `npm run test:unit` | Vitest |
| `npm run test:smoke` | Playwright smoke suite |
| `npm run test:api` | Playwright API suite |

## Layout

```
src/
├── pages/(app)/home.tsx        # the workspace; owns all cross-pane state
├── components/workspace/
│   ├── AgentChat.tsx           # left pane: streaming chat, model picker, @ mentions
│   ├── CodeEditor.tsx          # right pane: textarea, gutter, selection toolbar
│   ├── DiffView.tsx            # per-hunk review
│   ├── SelectionToolbar.tsx    # floating toolbar over a selection
│   ├── MentionPicker.tsx       # @ autocomplete
│   ├── chat-client.ts          # /api/ai/* client, SSE decoding
│   ├── diff.ts                 # dependency-free line diff
│   └── mentions.ts             # mention model: token/payload builders
├── ai/                         # agent registration, chat routes, tools
├── schemas.ts                  # collections, including chat history
└── server/                     # HTTP, realtime, and action routes
worker.ts                       # Worker entry
```

### Constraints

- **Don't modify `src/pages/(app)/_layout.tsx`.** It renders `<main className="flex-1 overflow-y-auto min-h-0">`, so pages use `min-h-full` (not `h-screen`) and manage their own scrolling.
- **The agent never writes the buffer.** Changes go `proposal` → diff view → user accept.
- **`wrangler.toml`'s `name` is only a subdomain lease.** Identity is `DEEPSPACE_APP_ID` — data, secrets, and collaborators key to it. Renaming means changing `name` then `npx deepspace deploy --rename`, plus updating `APP_NAME` in `src/constants.ts` for the display name.

## Stack

React 19 · React Router 7 · TypeScript (strict) · Tailwind CSS 4 · Base UI · Vite · Cloudflare Workers · DeepSpace SDK · Vitest · Playwright
