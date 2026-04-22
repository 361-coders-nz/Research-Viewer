# Research Viewer (oxFlow Studio) — CLAUDE.md

Architecture notes for agents and new contributors. Read this first. This file is the source of truth for **how the app is wired** and **why** — if it contradicts the code, fix the file in the same commit.

GitHub: `github.com/361-coders-nz/Research-Viewer` · Prod: `oxflow-studio.vercel.app`

---

## What this is

Two-package workspace for the 361° / Oxcon research corpus:

- **`studio/`** — Next.js 16 (App Router + Turbopack) web app. The canvas is the only surface where trees are rendered.
- **`studio-bridge/`** — Node WebSocket server the user runs locally. Spawns their own `claude` CLI for chat + tree generation. Session summaries land in `~/Desktop/oxflow-studio/sessions/`.

Client-side app only. The one server route is `/api/liveblocks-auth/route.ts` (fallback when a public Liveblocks key isn't set). The LLM plane never touches Vercel — every chat turn and tree generation goes through the user's local bridge at `ws://localhost:4456`.

Collaborative state lives in **Liveblocks**, two room kinds:

```
workspace-<id>          — team-level: imported docs, canvas directory
canvas-<nanoid>         — per-canvas: nodes, edges, chat threads, meta
```

---

## Architectural decisions (read before changing anything)

### 1. Liveblocks for all shared state
- No server-side storage beyond Liveblocks' cloud. Deploys are stateless.
- Every mutation goes through `useWorkspaceMutation` / `useCanvasMutation`. These throw if called before storage loads — so every page that issues mutations sits under `<ClientSideSuspense>`.
- `DocRecord.body` is a single string; Liveblocks' per-field cap is ~128KB. If research md grows past that, split into `bodyChunks: string[]` and reassemble on read.

### 2. LLM runs on the user's machine, never on Vercel
- `studio-bridge` is a tiny local ws server the user starts once. It spawns `claude -p …` using their local `claude` binary, reusing whatever auth Claude Code has. No API key lives in the deployed app.
- Chat + tree generation only work when the bridge is up. The top-bar `BridgeStatusBadge` turns green on connect.
- stream-json parsing happens in the bridge. The browser only sees high-level events (`chat.delta`, `tree.status`, `tree.ready`, etc.) defined in `studio/lib/bridge.ts`.

### 3. Trees live on the canvas as individual nodes
There's no separate tree viewer. Every generated tree is expanded into one `CanvasNodeConcept` per concept + `CanvasEdge` entries for parent→child links, all laid out with dagre (`studio/lib/conceptLayout.ts`) from the drop position. Two entry points:

- **Canvas drop / paste** — drop an `.md` on the canvas or paste markdown with `⌘V`. Sends a `tree.generate` with `kind: "synthesis"` over a single synthetic source. On `tree.ready`, `Canvas.tsx` flattens the result and mutates in nodes + edges at once. `fitView({ nodes })` auto-frames the new subtree so it can't be missed.
- **Chat-bubble synthesis** — a chat bubble in Tree mode with attached doc chips triggers the same flow from inside a node (`ChatBubbleNode` uses the shared `flattenTree` + `layoutFlat` helpers).

**Branch querying.** Each non-root concept has a Chat button. Clicking spawns a chat bubble seeded with a `role: "system"` message carrying the branch's label / summary / excerpt. The bubble hides the seed from its visible feed but forwards it as history so Claude stays grounded.

**No hallucinated excerpts.** The bridge validates each `excerpt` as a verbatim substring (whitespace-normalised) of the provided sources before emitting `tree.ready`. Paraphrased nodes are dropped server-side.

### 4. TreeGeneratorHost is a singleton
Tree generation starts in one place and the bridge reply may arrive after the originating component unmounts.

- The WS listener lives in `<TreeGeneratorHost />`, mounted **once** in `app/layout.tsx`.
- Pending jobs are kept in a module-scope `Map` (`PENDING` in `useTreeGenerator.ts`), not component state.
- Two listener channels route results: `SYNTHESIS_LISTENERS` (chat-bubble) and `CANVAS_DROP_LISTENERS` (canvas drop / paste). Each callback receives the full `job`, so subscribers filter by their own `canvasId` / `chatThreadId`.

### 5. Drag-drop everywhere, no multi-click pickers
- Global drop zone (outside the canvas) imports md into the workspace drawer.
- Doc drawer → canvas surface via HTML5 drag with `application/x-oxflow-doc` payload (JSON: `{ slug, title }`).
- Canvas surface also accepts `.md` file drops (imports to workspace AND generates a tree on canvas) and plain-text drops.
- React Flow nodes are draggable by default; interactive children use `className="nodrag"`.

### 6. Next.js conventions
- App Router + Turbopack. Server components only where they must be (the auth route). Everything else is client.
- Dynamic `params` is awaited: `use(params)` in client components, `await params` in server components.
- **No Tailwind.** Styles live in `app/globals.css` via tokens from `oxflow-mono/BRANDING.md`. Reusable utility classes (`.btn`, `.cnode--*`, `.canvas-titlebar`, `.geo-bg`).

---

## Wire protocol (bridge ↔ studio)

Defined in `studio/lib/bridge.ts` and mirrored in `studio-bridge/src/index.ts`. Bump the bridge `VERSION` on breaking changes.

**Client → bridge**
```jsonc
{ "type": "chat.start",    "sessionId", "systemPrompt", "userMessage", "history": [...] }
{ "type": "chat.cancel",   "sessionId" }
{ "type": "session.close", "sessionId", "title", "contextDocs", "history": [...] }
{ "type": "tree.generate", "sessionId", "kind": "per-doc" | "synthesis",
                           "focusPrompt": string | null,
                           "sources": [{ slug, title, body }] }
```

**Bridge → client**
```jsonc
{ "type": "hello",        "bridgeVersion", "sessionsDir", "claudeBin" }
{ "type": "chat.delta",   "sessionId", "delta" }
{ "type": "chat.done",    "sessionId" }
{ "type": "session.saved","sessionId", "path" }
{ "type": "tree.status",  "sessionId", "status": "generating" }
{ "type": "tree.ready",   "sessionId", "tree": { rootLabel, nodes }, "droppedNodes" }
{ "type": "tree.error",   "sessionId", "message" }
{ "type": "error",        "sessionId?", "message" }
```

Session IDs are bridge-stateless: the client generates them, the bridge echoes them on each reply. Cancels route to the child process via the bridge's `activeStreams` Map. Client-side `kind` can be `"canvas-drop"` but only `synthesis` / `per-doc` go on the wire — `canvas-drop` only affects which local listener channel fires.

---

## Local development

```bash
# Studio
cd studio
npm install
cp .env.example .env.local       # fill Liveblocks keys + NEXT_PUBLIC_DEFAULT_WORKSPACE
npm run dev                      # http://localhost:3000
npm run typecheck

# Bridge (needed for chat + tree generation)
cd ../studio-bridge
npm install
npm start                        # ws://127.0.0.1:4456
```

Neither starts the other. Both run for the full experience.

---

## Deploy

```bash
cd studio
vercel --prod --yes
```

Env vars live on Vercel; `vercel env add NAME production` if one goes missing. **Always deploy from `studio/`, not the repo root** — the repo root isn't a Next.js app, so deploying from there fails with "Couldn't find pages or app directory."

---

## Conventions + rules

1. **No Tailwind.** New styles go into `app/globals.css` alongside the token block.
2. **Mutations only via Liveblocks hooks**, gated by `<ClientSideSuspense>` upstream.
3. **Doc drag payload** is MIME `application/x-oxflow-doc` with JSON `{ slug, title }`. Components that accept doc drops check the type and `preventDefault` on `dragover`.
4. **Canvas node contract.** Each variant in `CanvasNode` union (`doc | note | chat | concept`) must have a component in `components/nodes/`, registered in `Canvas.tsx`'s `nodeTypes`. Every node renders: `<NodeDeleteButton id={id} />`, a header, a body, and both React Flow handles (even if unused).
5. **No hallucinated excerpts ship.** Don't relax the bridge's verbatim-substring check. If you change `treePrompt.ts`, validate with a real corpus sample.
6. **Bridge stays localhost-bound.** Don't widen `verifyClient` origins without explicit sign-off.
7. **Deploy from `studio/` only.** There's a `.vercel` link in that directory; don't create one at the repo root.

---

## Known limitations

- **Bridge has no chunking for large md.** A 100KB+ doc passed whole may blow Claude's context. Error surfaces back to the UI via a toast; there's no retry.
- **Canvas trees are per-canvas.** Not surfaced at a workspace level. If cross-canvas roll-up is wanted later, add a workspace-level `syntheses` map and a dedicated surface.
- **User identity is `localStorage` only** (`oxflow-studio:user`). No per-user progress store.
- **No tests.** `npm run typecheck` is the safety net.
- **Bridge has no client-side timeout.** If the bridge hangs or Claude takes forever, the persistent "Generating…" toast stays up until manually dismissed.

---

## How to extend

**Add a new canvas node type:**
1. Add a `CanvasNodeXxx` variant to `lib/liveblocks.ts`'s `CanvasNode` union.
2. Create `components/nodes/XxxNode.tsx` (accepts `NodeProps`, renders delete button + handles).
3. Register in `Canvas.tsx`'s `nodeTypes`.
4. Add a toolbar button + `useCanvasMutation` to push into `storage.get("nodes")`.

**Add a new bridge message:**
1. Extend `BridgeInbound` / `BridgeOutbound` in `studio/lib/bridge.ts`.
2. Mirror the type in `studio-bridge/src/index.ts`.
3. Handle in the bridge's `wss.on('connection', …)` switch.
4. Bump the bridge `VERSION`.

**Change the tree-gen prompt:** edit `studio-bridge/src/treePrompt.ts`. Re-run against a real doc to confirm excerpts still match verbatim after the change.

---

## Non-obvious pitfalls (don't re-break)

- **"RoomProvider is missing from the React tree"** — Liveblocks hook rendered outside the provider. `RoomProviders` always mounts with a server-stable `SSR_FALLBACK_USER`; real identity hydrates in `useEffect`.
- **"This mutation cannot be used until storage has been loaded"** — keyboard shortcuts firing before Liveblocks synced. The whole app sits under `<ClientSideSuspense>`; keyboard handlers also gate on `nodesStorage != null`.
- **fitView on empty ReactFlow** fails silently. After pushing a concept tree, wrap `fitView({ nodes })` in a short `setTimeout` + try/catch so it retries once nodes are mounted.
- **Quote highlighting breaks markdown tables** if injected into the md source. The fix is a post-render DOM walker in `MarkdownReader.tsx` that wraps text nodes client-side. Don't reintroduce `rehype-raw`.
- **Multiple `useTreeGenerator` instances** would split the pending-jobs state if it lived in `useRef`. It's in module scope (`PENDING` Map) on purpose.
- **Toast default duration is 3.2s.** Long-running flows (tree generation) must use `durationMs: 0` for persistent toasts and dismiss explicitly on outcome via `dismissToast(id)`.
- **GlobalDropZone vs CanvasSurface drop conflict.** The window-level GlobalDropZone listener skips drops whose target is inside `.canvas-surface` so the canvas handler wins for md-on-canvas drops.
- **Vercel deploy from repo root fails.** The Next.js app is in `studio/`; deploying from the parent finds no `app/` or `pages/`. Deploy from `studio/` only.

---

## What's been built (compressed history)

- **v0.1–v0.3** — Next.js scaffold, Liveblocks workspace + canvas rooms, markdown import via drag-drop, reader with TOC/wikilinks/BR auto-links, React Flow canvas with DocCard/Note/Chat nodes, presence cursors. Studio-bridge CLI spawning `claude -p` with stream-json. Claude-generated concept trees with verbatim-excerpt validation. (Course module was planned then removed; don't reintroduce.)
- **v0.4** — Scrapped the `/tree` page entirely. Trees moved to the canvas as a single compact `SynthesisTreeNode`. Added canvas-drop + paste-to-tree flow; branch-chat spawns a seeded chat bubble per concept.
- **v0.5 (current)** — Concept trees now expand into individual React Flow nodes (`CanvasNodeConcept`) with edges (`CanvasEdge`) laid out via dagre. Root concept visually distinct. Click-to-rename canvas titles. Double-click canvas → new chat bubble. Auto-`fitView` frames new subtrees. Persistent "Generating…" toast tied to session id, auto-cleared on ready/error. Canvas `.md` drop now also imports to the workspace drawer. Repo pushed to `github.com/361-coders-nz/Research-Viewer`.

---

## Who this is for

Team tool for 361° / Oxcon on the oxFlow research corpus. The maintainer iterates in short cycles, deploys continuously, and prefers direct feedback. Two non-negotiables:

- **60fps perceived perf** on canvas/tree interactions (memoised React Flow nodes, batched position commits, `transform: translate3d` for drags).
- **No hallucinated content.** Every Claude-generated concept must trace back to a verbatim source passage.
