# studio

The Next.js 16 app.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Turbopack dev server at http://localhost:3000 |
| `npm run build-course` | Parses `course-sources/*.md`, verifies every quote, emits `content/course.json`. Run this before `dev` the first time. |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |

## Environment variables

| Name | Purpose |
|---|---|
| `LIVEBLOCKS_SECRET_KEY` | Server-side auth (required for multiplayer). |
| `NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY` | Optional — enables public-key auth so no `LIVEBLOCKS_SECRET_KEY` needed client-side. |
| `NEXT_PUBLIC_BRIDGE_URL` | WebSocket URL of the local bridge. Defaults to `ws://localhost:4456`. |
| `NEXT_PUBLIC_DEFAULT_WORKSPACE` | Logical id of the workspace everyone joins. Change per team. Default `oxflow-team`. |

Set these in `.env.local`.

## Deploy to Vercel

```bash
vercel link   # root directory = studio/
vercel env add LIVEBLOCKS_SECRET_KEY
vercel env add NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY
vercel --prod
```

Then tell the team to run `studio-bridge` locally if they want chat bubbles.

## How features work

### Drag-drop import
`components/GlobalDropZone.tsx` captures drop events, walks directories
recursively via `webkitGetAsEntry`, passes files to `useImport.tsx` which
parses with `gray-matter`, extracts wikilinks + BR refs + headings, then
writes `LiveObject<DocRecord>` into the workspace room's `docs` LiveMap.

### Recursive trees
`components/TreeExplorer.tsx` manages a stack of `TreeView`s. Clicking any
drillable node pushes a crumb. `lib/tree.ts` has four builders — `buildWorkspaceTree`,
`buildDocTree`, `buildChatTree`, `buildRuleTree` — all of which produce the
same `TreeSnapshot` shape consumed by `TreeView`.

### Canvas
`app/canvas/[id]` mounts a `CanvasRoomProvider`. The surface is a controlled
React Flow with three custom node types (doc, note, chat). Doc drag comes
from `DocDrawer`; double-click creates a note; `+ Chat` button creates a chat
bubble. Positions commit to Liveblocks only on drag end (batched via
`commitPositions`). Presence cursors show other users live.

### Chat bubbles → bridge
`components/nodes/ChatBubbleNode.tsx` assembles a system prompt from the
current workspace docs, sends `chat.start` to the local ws bridge, and
appends `chat.delta` chunks to the streaming assistant message. Messages
live in Liveblocks so collaborators see the stream.

### Course
`scripts/build-course.ts` loads `course-sources/*.md`, walks a hand-curated
question catalogue, and **verifies every `sourceQuote` exists verbatim in
its named source file**. If a quote is missing, the build fails — prevents
drift between questions and docs. Output is `content/course.json`, loaded
server-side by `lib/course.ts` and rendered by `/course/[id]`.

### Markdown highlight
`components/MarkdownReader.tsx` accepts a `highlightQuote` prop. After
render, a `useEffect` scans the rendered DOM text nodes, finds the verbatim
quote, wraps it in `<mark class="highlight-quote">`, and scrolls into view.
Done client-side so tables, code blocks, and other markdown constructs stay
intact in the source.
