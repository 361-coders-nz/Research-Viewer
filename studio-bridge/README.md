# oxflow-studio-bridge

Localhost WebSocket bridge that spawns your **local `claude` CLI** for each
oxFlow Studio chat bubble. Uses whatever auth you have configured for
Claude Code — no separate API key, no cloud call from the deployed Studio.

Session summaries auto-save as markdown so you can re-open past
conversations later.

## Quick start

```bash
cd studio-bridge
npm install
npm start
#   listening on ws://127.0.0.1:4456
#   claude binary claude
#   sessions dir  /Users/<you>/Desktop/oxflow-studio/sessions
```

Your Studio (in the browser) will detect the bridge automatically — the
top-bar "Bridge" badge turns green.

## How it works

Per chat-bubble turn, the bridge spawns:

```bash
claude -p "<flattened conversation>" \
  --system-prompt "<studio-supplied prompt>" \
  --output-format stream-json \
  --include-partial-messages \
  --verbose \
  --model sonnet
```

It parses the line-delimited JSON output, extracts `text_delta` events
from `content_block_delta`, and forwards them to the browser as
`chat.delta` WebSocket messages.

Cancel = `SIGTERM` to the child process.

At session close, a **second** one-shot `claude -p` call summarises the
transcript into a tl;dr, and the whole conversation is written as a
markdown file under `~/Desktop/oxflow-studio/sessions/`.

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `OXFLOW_BRIDGE_PORT` | `4456` | WebSocket port |
| `OXFLOW_BRIDGE_HOST` | `127.0.0.1` | Bind localhost-only by default |
| `OXFLOW_BRIDGE_MODEL` | `sonnet` | Passed to `claude --model` |
| `OXFLOW_BRIDGE_CLAUDE_BIN` | `claude` | Path to the `claude` binary |
| `OXFLOW_BRIDGE_SESSIONS` | `~/Desktop/oxflow-studio/sessions` | Where session summaries are written |
| `OXFLOW_BRIDGE_ORIGINS` | `http://localhost:3000,…` | Allowed browser origins |

## Security

- Binds `127.0.0.1` only; nothing outside your machine can reach the bridge
- WebSocket upgrade is origin-checked (localhost + `*.vercel.app` + `*.3sixtyone.co` by default)
- Your Claude Code auth never leaves this process
- Each turn is an isolated subprocess — no persistent session state on the bridge

## Troubleshooting

- **Badge stays red** — bridge isn't running. Check `curl http://127.0.0.1:4456/health`.
- **Canvas connects but no stream** — does `which claude` resolve on the shell that started `npm start`? Set `OXFLOW_BRIDGE_CLAUDE_BIN` to the absolute path if needed.
- **"Origin not allowed"** — your browser origin isn't in the allow-list. Set `OXFLOW_BRIDGE_ORIGINS=https://your-app.vercel.app,http://localhost:3000`.

## Wire protocol

```jsonc
// client → bridge
{ "type": "chat.start", "sessionId": "s_abc", "systemPrompt": "...",
  "userMessage": "...", "history": [{"role":"user","content":"..."}] }
{ "type": "chat.cancel", "sessionId": "s_abc" }
{ "type": "session.close", "sessionId": "s_abc", "title": "...",
  "history": [...] }

// bridge → client
{ "type": "hello", "bridgeVersion": "...", "sessionsDir": "...", "claudeBin": "..." }
{ "type": "chat.delta", "sessionId": "s_abc", "delta": "..." }
{ "type": "chat.done",  "sessionId": "s_abc" }
{ "type": "session.saved", "sessionId": "s_abc", "path": "/..." }
{ "type": "error", "sessionId": "s_abc", "message": "..." }
```
