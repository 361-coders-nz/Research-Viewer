# oxFlow Studio — CLAUDE.md

Authoring contract + architecture notes for this repo. Read this first if you're a fresh AI agent or a new contributor. The file is the single source of truth for **how this app is wired together** and **why**.

> If something here contradicts the code, the code wins — but update this file in the same commit.

---

## What this is

`oxflow-studio` is a two-package workspace that gives the oxFlow team an interactive place to explore its markdown research corpus:

- **`studio/`** — Next.js 16 (App Router + Turbopack) web app. Deployed to Vercel at **https://oxflow-studio.vercel.app**. The canvas is the only working surface; there is no separate tree viewer since v0.4.
- **`studio-bridge/`** — tiny Node.js WebSocket server the user runs locally. Spawns their own `claude` CLI for chat bubbles and concept-tree generation. Writes session summaries to `~/Desktop/oxflow-studio/sessions/`.

The deployed app is entirely client-side (SSR + Liveblocks). The only server-side Next.js route is `/api/liveblocks-auth/route.ts`, used as a fallback when a public Liveblocks key isn't set.

Primary data plane is **Liveblocks** — two room kinds:

```
workspace-<id>          — team-level state (imported docs, canvas directory, docTrees)
canvas-<nanoid>         — per-canvas state (nodes, edges, chat threads, meta)
```

The LLM plane never touches Vercel. Every chat turn and every tree generation round-trips through the user's **local** `studio-bridge` process at `ws://localhost:4456`, which spawns `claude -p …` using whatever auth the user has on their machine. The browser can connect to `ws://localhost` from HTTPS because localhost is a secure context in Chromium and Firefox.

---

## Repo layout (authoritative)

```
oxflow-studio/
├── CLAUDE.md                       ← this file
├── README.md                       ← top-level quick start
├── studio/                         ← the Next.js app
│   ├── app/
│   │   ├── layout.tsx              ← mounts RoomProviders, TopBar, TreeGeneratorHost, GlobalDropZone
│   │   ├── page.tsx                ← hub with tiles + drop zone + user's docs/canvases
│   │   ├── globals.css             ← CSS tokens + component styles (no Tailwind)
│   │   ├── tree/page.tsx           ← TreeExplorer page
│   │   ├── reader/[...slug]/page.tsx
│   │   ├── canvas/page.tsx + [id]/page.tsx
│   │   └── api/liveblocks-auth/route.ts
│   ├── components/
│   │   ├── RoomProviders.tsx       ← User context + WorkspaceRoomProvider + ClientSideSuspense
│   │   ├── TopBar.tsx, GeoBg.tsx, UserMenu.tsx, ToastHost.tsx, GlobalDropZone.tsx
│   │   ├── Canvas.tsx              ← DocDrawer + React Flow surface + tree popover
│   │   ├── TreeView.tsx, TreeNode.tsx, TreeExplorer.tsx, TreePopover.tsx
│   │   ├── MarkdownReader.tsx      ← react-markdown + post-render quote highlighter
│   │   ├── TreeStatusDot.tsx       ← 4-state dot used everywhere a tree's status is shown
│   │   ├── useTreeGenerator.ts     ← TreeGeneratorHost + useTreeGenerator + useDocTree hook
│   │   ├── RegenTreeMenu.tsx       ← dropdown + focus-prompt popover for per-doc regeneration
│   │   ├── useDocs.ts, useImport.tsx
│   │   ├── BridgeStatusBadge.tsx
│   │   └── nodes/
│   │       ├── DocCardNode.tsx
│   │       ├── NoteNode.tsx
│   │       ├── ChatBubbleNode.tsx  ← attach-docs strip + Chat/Tree mode toggle
│   │       ├── SynthesisTreeNode.tsx  ← renders a generated tree as a canvas node
│   │       └── NodeChrome.tsx      ← shared NodeDeleteButton
│   ├── lib/
│   │   ├── liveblocks.ts           ← client, Presence, storage types, room contexts
│   │   ├── bridge.ts               ← BridgeClient singleton + wire types
│   │   ├── parse.ts                ← gray-matter + regex md parser (body → DocRecord)
│   │   ├── tree.ts                 ← TreeSnapshot builders (workspace/doc/chat/rule) + dagre layout
│   │   ├── toast.ts                ← tiny pubsub toast store
│   │   └── user.ts                 ← localStorage-backed StudioUser
│   ├── .env.local                  ← Liveblocks keys + optional bridge url (gitignored)
│   ├── vercel.json
│   └── package.json
└── studio-bridge/                  ← local-only Node CLI
    ├── src/
    │   ├── index.ts                ← ws+http server, spawn handlers
    │   └── treePrompt.ts           ← locked system prompt for concept trees
    ├── bin/oxflow-studio-bridge
    ├── README.md
    └── package.json
```

---

## Architectural decisions (the ones you need to understand before changing anything)

### 1. Liveblocks for all shared state

Every piece of collaborative state lives in a Liveblocks room. The client doesn't have a database of its own. This means:

- **No server-side storage** beyond Liveblocks' cloud. Deploys are stateless.
- **Drag-drop import parses client-side** and writes `LiveObject<DocRecord>` entries into the workspace room. No upload API. No S3. No build-time ingest.
- **All mutations are wrapped in `useWorkspaceMutation` / `useCanvasMutation`**. These throw if called before storage loads — so every page that issues mutations must sit inside a `<ClientSideSuspense>` boundary (the layout already wraps one around children; canvas pages wrap their own).
- **Doc chunking**: `DocRecord.body` is a single string. Liveblocks' per-field cap is ~128KB. We don't chunk yet because research md files are almost always <50KB. If this changes, split into `bodyChunks: string[]` and reassemble on read.

### 2. LLM runs **on the user's machine**, never on Vercel

`studio-bridge` is a tiny local ws server the user starts once. It spawns `claude -p …` using their local `claude` binary, which picks up whatever auth they have configured for Claude Code. No API key lives in the deployed app. This means:

- **Chat bubbles + tree generation only work when the user has the bridge running.** The top-bar BridgeStatusBadge is green when connected, amber/red otherwise.
- **No cloud bill on the team's Vercel account** for model inference.
- **Stream-json is parsed in the bridge**, not the browser. The browser only sees high-level events (`chat.delta`, `tree.status`, `tree.ready`, etc.) defined in `studio/lib/bridge.ts`. This keeps the browser-side code agnostic to the CLI's output format.

### 3. Trees only live on the canvas (v0.4)

There is no separate tree viewer. Every generated tree is rendered as a `SynthesisTreeNode` inside a canvas room. Two entry points spawn one:

- **Canvas-drop** — drop an `.md` file on the canvas OR paste markdown with Cmd/Ctrl+V. The canvas handler sends a `tree.generate` with `kind: "synthesis"` over a single synthetic source (e.g. `slug: "paste-xxxx"`), and on `tree.ready` pushes a `CanvasNodeTree` at the drop/paste position.
- **Chat-bubble synthesis** — a chat bubble in Tree mode with attached doc chips hits the purple 🕸 button and a `SynthesisTreeNode` spawns beside it.

Every Claude-generated node carries `{ label, summary, excerpt, sourceSlug, children? }`. The bridge **verifies each excerpt appears verbatim** (whitespace-normalised substring) in the provided sources — paraphrased nodes are dropped server-side before the tree is emitted. Same rule applies to both entry points; the bridge doesn't care where sources come from.

**Branch querying.** Each concept in a tree has a Chat button. Clicking it spawns a chat bubble to the right seeded with a `role: "system"` message containing the branch's label/summary/excerpt. The bubble hides the system seed from its visible feed but still sends it to Claude as history so answers stay grounded.

### 4. TreeGeneratorHost is a singleton mount

Tree generation is started from one place (canvas drop/paste or a chat bubble) and the bridge reply arrives later — possibly after that component unmounts. So:

- The **WS listener** lives in `<TreeGeneratorHost />`, mounted **once** in `app/layout.tsx`. It never unmounts during navigation.
- Pending jobs are kept in a **module-scope `Map`** (`PENDING` in `useTreeGenerator.ts`), not component state. Any hook that creates a job registers it here; the Host resolves it when bridge replies arrive.
- Two module-scope listener channels route results to the right surface: `SYNTHESIS_LISTENERS` (chat-bubble-originated) and `CANVAS_DROP_LISTENERS` (canvas-drop/paste originated). Each job kind routes to exactly one channel, with the callback carrying the full `job` object so multi-bubble / multi-canvas filtering is straightforward.

### 5. Drag-drop everywhere, no multi-click picker

- **Global drop zone** (whole page) for import.
- **Doc drawer → canvas surface** via HTML5 drag with `application/x-oxflow-doc` payload. Same payload is accepted by chat bubbles for synthesis attachment.
- **React Flow nodes** are draggable by default; we disable drag on interactive children via `className="nodrag"`.

### 6. Next.js conventions we follow

- **App Router + Turbopack**. Server components only where they have to be (the Liveblocks auth route). Everything else is client.
- **Dynamic `params` is awaited** — `use(params)` on client components, `await params` on server components.
- **CSS tokens lifted from `oxflow-mono/BRANDING.md` into `app/globals.css`**. No Tailwind. Utility classes like `.btn`, `.panel`, `.tnode`, `.cnode--*` are declared once and reused. Match the ink ladder, accent green, grid `.geo-bg`.

---

## Wire protocol (bridge ↔ studio)

Defined in `studio/lib/bridge.ts` and mirrored in `studio-bridge/src/index.ts`. Breaking changes must bump the `VERSION` constant in the bridge and update both files.

### Client → bridge
```jsonc
{ "type": "chat.start",   "sessionId", "systemPrompt", "userMessage", "history": [...] }
{ "type": "chat.cancel",  "sessionId" }
{ "type": "session.close","sessionId", "title", "contextDocs", "history": [...] }
{ "type": "tree.generate","sessionId", "kind": "per-doc" | "synthesis",
                          "focusPrompt": string | null,
                          "sources": [{ slug, title, body }] }
```

### Bridge → client
```jsonc
{ "type": "hello",       "bridgeVersion", "sessionsDir", "claudeBin" }
{ "type": "chat.delta",  "sessionId", "delta" }
{ "type": "chat.done",   "sessionId" }
{ "type": "session.saved","sessionId", "path" }
{ "type": "tree.status", "sessionId", "status": "generating" }
{ "type": "tree.ready",  "sessionId", "tree": { rootLabel, nodes }, "droppedNodes" }
{ "type": "tree.error",  "sessionId", "message" }
{ "type": "error",       "sessionId?", "message" }
```

Session IDs are **bridge-stateless** — the client generates them, the bridge echoes them back on each reply. Cancels map back to the child process via the bridge's `activeStreams` Map.

---

## What's been built (changelog-ish)

### v0.1 — core app
- Next.js scaffold with CSS tokens, `.geo-bg`, Inter + JetBrains Mono, `.shell` layout
- Liveblocks workspace + canvas rooms, `Presence`, `StudioUser`
- Drag-drop md import parsed client-side with `gray-matter` → `DocRecord`
- `/` hub with drop zone + tiles + canvas/docs lists
- `/reader/[...slug]` with TOC, wikilinks rewrite, BR auto-link
- `/tree` with breadcrumb-stacked recursive trees (workspace / doc / chat / rule sources)
- `/canvas/[id]` with React Flow + Liveblocks, DocCard + Note + Chat nodes, presence cursors

### v0.2 — bridge + chat bubbles
- `studio-bridge` CLI; WebSocket server, origin check, localhost binding
- Spawn `claude -p` with `stream-json`, forward `content_block_delta` → `chat.delta`
- Session summaries written to `~/Desktop/oxflow-studio/sessions/YYYY-MM-DD-Thhmm-*.md`

### v0.4 — Canvas-first trees (current)
- **Scrapped `/tree` page** and its popover, TreeExplorer/View/Node, RegenTreeMenu, TreeStatusDot, `lib/tree.ts`, and the `docTrees` workspace storage.
- **Canvas becomes the only tree surface.** Drop an `.md` file on the canvas OR paste markdown (Cmd/Ctrl+V) to generate a concept tree inline as a `SynthesisTreeNode`. Under the hood this spawns a `canvas-drop` pending job (see `components/useTreeGenerator.ts`) that hits the bridge's synthesis path with a single synthetic source.
- **GlobalDropZone skips drops that targeted `.canvas-surface`** so the canvas handler wins for md-on-canvas drops; workspace import still fires for drops outside the canvas.
- **Query a branch from the canvas.** Each concept inside `SynthesisTreeNode` has a Chat button that spawns a `ChatBubbleNode` pre-seeded with a `role: "system"` message containing the branch's label/summary/excerpt. The chat bubble hides system messages from the visible feed but shows a dim "context" banner and still forwards them to Claude in history.
- **Dead-code removal.** `per-doc` tree gen, `useDocTree`, auto-generation on import, and the "open as tree" buttons on DocCardNode and ChatBubbleNode are gone. `docTrees: LiveMap` is removed from `WorkspaceStorage`.
- **Import diagnostics.** `useImport.tsx` now surfaces per-file failures via toast and logs `[import]` + `[docs]` summaries so silent import bugs are observable without a deep dive.

### v0.3 — Claude-generated concept trees
- Shared types: `GeneratedTree`, `GeneratedNodeJson`, `CanvasNodeTree`, `CanvasNodeChat.attachedSlugs`
- `workspaceStorage.docTrees: LiveMap<slug, LiveObject<GeneratedTree>>`
- Locked system prompt at `studio-bridge/src/treePrompt.ts`
- `tree.generate` handler spawns `claude`, parses JSON, **verifies excerpts verbatim**, drops paraphrased nodes
- `TreeStatusDot` shown on drawer chips + canvas DocCards (4 states: pending/generating/ready/error)
- `RegenTreeMenu` dropdown: Regenerate / Regenerate with focus… / Remove doc
- `useTreeGenerator` hook + `TreeGeneratorHost` singleton for WS listener lifetime
- Flow A: import → auto `tree.generate` → status dot animates → `/tree` doc sub-tree surfaces "Claude breakdown" as primary branch with clickable excerpts (link to reader with `?q=<excerpt>` highlight)
- Flow B: drag docs onto chat bubble → flip mode to Tree → hit 🕸 → bridge synthesises → `SynthesisTreeNode` appears on canvas

### Deployed
- `https://oxflow-studio.vercel.app`
- Env vars in production: `LIVEBLOCKS_SECRET_KEY`, `NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY`, `NEXT_PUBLIC_DEFAULT_WORKSPACE`
- Vercel project: `oxflow-studio` under account `admin-55954479`

---

## Local development

```bash
# ─── Studio ──────────────────────────────────────────────
cd studio
npm install
# First run: cp .env.example .env.local and fill in Liveblocks keys
npm run dev                     # → http://localhost:3000 (or :3001 if busy)
npm run typecheck               # tsc --noEmit

# ─── Bridge (needed for chat bubbles + tree generation) ──
cd ../studio-bridge
npm install
npm start                       # → ws://127.0.0.1:4456
# top-bar "Bridge" badge turns green in the browser
```

Neither starts the other. Both should be running for the full experience.

---

## Deploy

```bash
cd studio
vercel --prod --yes
```

`vercel.json` currently just declares the Next framework. No build-time content step. Env vars are in place in Vercel for prod; re-run with `vercel env add NAME production` if one goes missing.

---

## Conventions + rules

1. **No Tailwind.** Styles live in `app/globals.css` using the token block. If you reach for a utility class and it doesn't exist, add a sibling component-scoped rule rather than inlining a new system.

2. **Every mutation goes through a Liveblocks mutation hook.** Never mutate storage directly from an event handler. Mutations must be guarded by `<ClientSideSuspense>` upstream.

3. **Drag payloads use MIME type `application/x-oxflow-doc`** with a JSON body `{ slug, title }`. Any component that accepts doc drops should check for this type and call `preventDefault` on `dragover`.

4. **Node types** are registered in `Canvas.tsx`'s `nodeTypes`. Each canvas node variant in `CanvasStorage.nodes` must have a matching React Flow `type: <kind>` string and a component in `components/nodes/`. Each node component accepts the standard React Flow `NodeProps` and must render:
   - `<NodeDeleteButton id={id} />` at the top for removal
   - A header (icon + title)
   - A body
   - Handles (`<Handle type="source" …/>` and `<Handle type="target" …/>`) even if unused

5. **Tree sources** in `lib/tree.ts` all return a `TreeSnapshot` of `{ id, rootLabel, nodes[], edges[] }`. Rendering happens in `components/TreeView.tsx` via dagre layout. The TreeExplorer drills by pushing crumbs of kind `doc | heading | chat | rule`. **Heading-kind crumbs** never push a new tree — they open the reader (with optional `?q=<excerpt>` highlight). Drillable **doc/rule/chat** crumbs push a new pane in the stack.

6. **Tree status icon component (`TreeStatusDot`) is the single source of truth** for tree generation state visualisation. If you're adding a new surface that should show tree status, use this component.

7. **No hallucinated excerpts ever ship.** The bridge validates `excerpt` verbatim against the provided sources before emitting `tree.ready`. If you tweak the prompt, re-run the validation — the bridge drops nodes whose excerpts don't match.

8. **Respect localhost-only binding on the bridge.** Never widen the `verifyClient` origin check without an explicit ADR.

---

## Known limitations / open items

- **Course module was removed** in v0.3 after the user deemed it out of scope. Don't add it back without an ask.
- **GitHub "pull latest research" is out of scope** for v1. Docs enter the workspace only via drag-drop.
- **Synthesis trees are canvas-local.** They aren't surfaced in the global Tree Explorer. If requested, add a workspace-level `syntheses: LiveMap` and a new tree source.
- **Course-progress / per-user progress rooms don't exist.** User identity is `localStorage` only (`oxflow-studio:user`).
- **Bridge has no chunking for giant md.** A 100KB+ doc passed whole may blow the context window. The bridge surfaces Claude's error back to the UI; we don't retry.
- **No tests yet.** `npm run typecheck` is the primary safety net. Add vitest if behaviours are getting hard to verify manually.
- **`react-markdown` + `rehype-raw` conflict** was sidestepped by moving quote-highlighting to a post-render DOM walker in `MarkdownReader`. Don't reintroduce `rehype-raw` without revisiting that.

---

## How to extend (cheat sheet)

**Add a new canvas node type** (e.g. an embed):
1. Add a discriminated `CanvasNodeXxx` variant to `lib/liveblocks.ts`'s `CanvasNode` union.
2. Create `components/nodes/XxxNode.tsx` that accepts `NodeProps`, renders `NodeDeleteButton`, handles, and content.
3. Register it in `Canvas.tsx`'s `nodeTypes` map.
4. Add a toolbar button in `Canvas.tsx` that creates the node via a mutation on `storage.get("nodes").push(...)`.

**Add a new tree source** (e.g. entities):
1. Add a builder in `lib/tree.ts` returning a `TreeSnapshot`.
2. Extend the `Crumb.kind` union and wire it into the `trees` useMemo in `TreeExplorer.tsx`.
3. Update `TreeNode.tsx`'s `drill` switch if the new kind needs special payload routing.

**Add a new bridge message**:
1. Extend `BridgeInbound` / `BridgeOutbound` in `studio/lib/bridge.ts`.
2. Mirror the type in `studio-bridge/src/index.ts`.
3. Add the handler in `wss.on('connection', …)`'s message switch.
4. Bump `VERSION` in both files.

**Change the tree-gen prompt**:
- Edit `studio-bridge/src/treePrompt.ts`. Re-run with a real corpus sample to confirm the excerpt-verbatim rule still holds.

---

## Non-obvious pitfalls we already solved (don't re-break)

- **"RoomProvider is missing from the React tree"** — hit if you render a Liveblocks hook outside a provider. Fix is already applied: `RoomProviders` always mounts the provider with a server-stable `SSR_FALLBACK_USER`; real identity hydrates in `useEffect`.
- **"This mutation cannot be used until storage has been loaded"** — caused by keyboard shortcuts firing mutations before Liveblocks synced. Fix: the whole app sits under `<ClientSideSuspense>` in layout + canvas pages, and keyboard handlers check `nodesStorage != null` before calling add* mutations.
- **`fitView` + empty flex layout** — React Flow's fitView can fail on first render if parent has no height. `.tree-page { height: calc(100vh - 56px) }` was added to avoid.
- **Quote highlighting breaks markdown tables** — injecting `<mark>` into the md source disrupted pipes. Fix: post-render DOM walker in `MarkdownReader.tsx` wraps text nodes client-side. Don't revert to source-injection.
- **`Vercel build blocks vulnerable Next`** — we're pinned to `next@^16.2.4`. Don't downgrade below the patched version.
- **Multiple `useTreeGenerator` instances** would split the pending-jobs state if it was in `useRef`. It's in module scope (`PENDING` Map) on purpose. Don't move it back into a hook.

---

## Who this is for

The user is building a team tool for 361° / Oxcon on the oxFlow research corpus. They iterate in short cycles, deploy continuously, and prefer direct, specific feedback. They're comfortable with partial features ship-now → polish-later, but they call out accuracy and UX smoothness when they matter. Two non-negotiables so far:

- **60fps perceived perf** on canvas/tree interactions (memoised React Flow nodes, rAF-batched commits, `transform: translate3d` for drags).
- **No hallucinated content**. Every Claude-generated tree node must trace back to a verbatim source passage.
