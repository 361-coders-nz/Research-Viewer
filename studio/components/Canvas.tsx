"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  applyNodeChanges,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LiveList } from "@liveblocks/client";
import { nanoid } from "nanoid";
import { StickyNote, MessagesSquare, Search, Trash2 } from "lucide-react";
import {
  flattenTree,
  layoutFlat,
  type FlatConcept,
} from "@/lib/conceptLayout";
import {
  useCanvasStorage,
  useCanvasMutation,
  useCanvasOthers,
  useCanvasUpdateMyPresence,
  useWorkspaceStorage,
  useWorkspaceMutation,
  type CanvasNode as StoredCanvasNode,
  type CanvasNodeDoc,
  type CanvasNodeNote,
  type CanvasNodeChat,
  type CanvasNodeConcept,
  type CanvasEdge as StoredCanvasEdge,
  type CanvasMeta,
  type ChatMessage,
} from "@/lib/liveblocks";
import { DocCardNode } from "./nodes/DocCardNode";
import { NoteNode } from "./nodes/NoteNode";
import { ChatBubbleNode } from "./nodes/ChatBubbleNode";
import { ConceptNode } from "./nodes/ConceptNode";
import { useDocs } from "./useDocs";
import type { DocRecord } from "@/lib/liveblocks";
import { useStudioUser } from "./RoomProviders";
import { onCanvasDropResult, useTreeGenerator } from "./useTreeGenerator";
import { useImport } from "./useImport";
import { toast, dismissToast } from "@/lib/toast";

const nodeTypes: NodeTypes = {
  doc: DocCardNode,
  note: NoteNode,
  chat: ChatBubbleNode,
  concept: ConceptNode,
};

const kbdStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.7rem",
  padding: "1px 5px",
  borderRadius: 4,
  background: "var(--ink-05)",
  border: "1px solid var(--border-strong)",
  color: "var(--ink-80)",
};

export function Canvas({ canvasId }: { canvasId: string }) {
  return (
    <div className="canvas-page">
      <DocDrawer />
      <ReactFlowProvider>
        <CanvasSurface canvasId={canvasId} />
      </ReactFlowProvider>
    </div>
  );
}

// ===========================================================================
// Drawer
// ===========================================================================

function DocDrawer() {
  const docs = useDocs();
  const { removeDoc } = useImport();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(
      (d) =>
        d.title.toLowerCase().includes(q) || d.slug.toLowerCase().includes(q),
    );
  }, [docs, query]);

  const onDragStart = (e: React.DragEvent, doc: DocRecord) => {
    e.dataTransfer.setData(
      "application/x-oxflow-doc",
      JSON.stringify({ slug: doc.slug, title: doc.title }),
    );
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <aside className="canvas-drawer">
      <div className="canvas-drawer__header">
        <Search size={14} style={{ color: "var(--ink-40)", flexShrink: 0 }} />
        <input
          className="canvas-drawer__search"
          placeholder={`Search ${docs.length} doc${docs.length === 1 ? "" : "s"}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="canvas-drawer__list">
        {filtered.length === 0 ? (
          <div
            style={{
              padding: "1.2rem",
              fontSize: "0.85rem",
              color: "var(--ink-40)",
              textAlign: "center",
              lineHeight: 1.55,
            }}
          >
            {docs.length === 0
              ? "Drop .md files anywhere to import. Drag a doc onto the canvas as a card, or drop a new .md on the canvas itself to get a concept tree."
              : "No matches."}
          </div>
        ) : (
          filtered.map((d) => (
            <DrawerDocChip
              key={d.slug}
              doc={d}
              onDragStart={onDragStart}
              onRemove={() => removeDoc(d.slug)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function DrawerDocChip({
  doc,
  onDragStart,
  onRemove,
}: {
  doc: DocRecord;
  onDragStart: (e: React.DragEvent, doc: DocRecord) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="doc-chip"
      draggable
      onDragStart={(e) => onDragStart(e, doc)}
      title={doc.slug}
    >
      <span className="doc-chip__icon">
        <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor">
          <path d="M2 1h5l3 3v7H2z" opacity="0.3" />
          <path d="M2 1h5l3 3v7H2V1zm5 0v3h3" fill="none" stroke="currentColor" />
        </svg>
      </span>
      <span className="doc-chip__text">{doc.title}</span>
      <button
        className="btn-icon nodrag"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        title="Remove doc from workspace"
        style={{ padding: 4, color: "var(--ink-40)" }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ===========================================================================
// Title bar
// ===========================================================================

function CanvasTitleBar({ canvasId }: { canvasId: string }) {
  const canvases = useWorkspaceStorage((root) => root.canvases);
  const meta = canvases?.get(canvasId) as unknown as CanvasMeta | undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const renameCanvas = useWorkspaceMutation(
    ({ storage }, id: string, nextTitle: string) => {
      const m = storage.get("canvases").get(id);
      if (!m) return;
      m.update({ title: nextTitle, updatedAt: Date.now() });
    },
    [],
  );

  const title = meta?.title ?? "Untitled canvas";

  const commit = () => {
    const next = draft.trim();
    if (next && next !== title) {
      renameCanvas(canvasId, next);
    }
    setEditing(false);
  };

  return (
    <div className="canvas-titlebar">
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
          className="canvas-titlebar__input"
        />
      ) : (
        <button
          type="button"
          className="canvas-titlebar__label"
          onClick={() => {
            setDraft(title);
            setEditing(true);
          }}
          title="Click to rename this canvas"
        >
          {title}
        </button>
      )}
    </div>
  );
}

// ===========================================================================
// Surface
// ===========================================================================

function CanvasSurface({ canvasId }: { canvasId: string }) {
  const nodesStorage = useCanvasStorage((root) => root.nodes);
  const edgesStorage = useCanvasStorage((root) => root.edges);
  const updateMyPresence = useCanvasUpdateMyPresence();
  const others = useCanvasOthers();
  const { user } = useStudioUser();
  const { generateCanvasDrop } = useTreeGenerator();
  const { importFiles } = useImport();
  const { screenToFlowPosition, fitView } = useReactFlow();

  // Per-session toast tracking so we can dismiss the "Generating…" toast
  // when the bridge replies with ready or error.
  const sessionToasts = useRef<Map<string, string>>(new Map());

  const storedNodes = useMemo<StoredCanvasNode[]>(() => {
    if (!nodesStorage) return [];
    const out: StoredCanvasNode[] = [];
    for (const n of nodesStorage) out.push(n as StoredCanvasNode);
    return out;
  }, [nodesStorage]);

  const storedEdges = useMemo<StoredCanvasEdge[]>(() => {
    if (!edgesStorage) return [];
    const out: StoredCanvasEdge[] = [];
    for (const e of edgesStorage) out.push(e as StoredCanvasEdge);
    return out;
  }, [edgesStorage]);

  // ---- mutations ---------------------------------------------------------

  const addDocAt = useCanvasMutation(
    ({ storage }, slug: string, position: XYPosition) => {
      const nodes = storage.get("nodes");
      nodes.push({
        id: nanoid(10),
        kind: "doc",
        position,
        slug,
      } as CanvasNodeDoc);
    },
    [],
  );

  const addNote = useCanvasMutation(({ storage }, position: XYPosition) => {
    storage.get("nodes").push({
      id: nanoid(10),
      kind: "note",
      position,
      body: "",
    } as CanvasNodeNote);
  }, []);

  const addChat = useCanvasMutation(
    ({ storage }, position: XYPosition, ownerUserId: string) => {
      const threadId = `thr_${nanoid(8)}`;
      storage.get("nodes").push({
        id: nanoid(10),
        kind: "chat",
        position,
        threadId,
        title: "New chat",
        ownerUserId,
      } as CanvasNodeChat);
      storage.get("chatThreads").set(threadId, new LiveList([]));
    },
    [],
  );

  const addConceptTree = useCanvasMutation(
    (
      { storage },
      flat: FlatConcept[],
      positions: Map<string, XYPosition>,
    ) => {
      const nodes = storage.get("nodes");
      const edges = storage.get("edges");
      for (const n of flat) {
        const pos = positions.get(n.id) ?? { x: 0, y: 0 };
        nodes.push({
          id: n.id,
          kind: "concept",
          position: pos,
          rootId: n.rootId,
          isRoot: n.isRoot,
          label: n.label,
          summary: n.summary,
          excerpt: n.excerpt,
          sourceSlug: n.sourceSlug,
        } as CanvasNodeConcept);
      }
      for (const n of flat) {
        if (!n.parentId) continue;
        edges.push({
          id: `${n.parentId}->${n.id}`,
          source: n.parentId,
          target: n.id,
        } as StoredCanvasEdge);
      }
    },
    [],
  );

  const addChatForConcept = useCanvasMutation(
    (
      { storage },
      position: XYPosition,
      ownerUserId: string,
      concept: { label: string; summary: string; excerpt: string; sourceSlug: string },
    ) => {
      const threadId = `thr_${nanoid(8)}`;
      const systemSeed: ChatMessage = {
        id: nanoid(10),
        role: "system",
        content: `Branch: ${concept.label}\nSummary: ${concept.summary}\nExcerpt: "${concept.excerpt}"\n\nAnswer questions about this branch, citing the excerpt when helpful.`,
        timestamp: Date.now(),
      };
      storage.get("nodes").push({
        id: nanoid(10),
        kind: "chat",
        position,
        threadId,
        title: concept.label,
        ownerUserId,
      } as CanvasNodeChat);
      storage.get("chatThreads").set(threadId, new LiveList([systemSeed]));
    },
    [],
  );

  const commitPositions = useCanvasMutation(
    ({ storage }, updates: Record<string, XYPosition>) => {
      const nodes = storage.get("nodes");
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes.get(i)!;
        const next = updates[n.id];
        if (!next) continue;
        nodes.set(i, { ...n, position: next });
      }
    },
    [],
  );

  const removeNode = useCanvasMutation(({ storage }, id: string) => {
    const nodes = storage.get("nodes");
    for (let i = 0; i < nodes.length; i++) {
      if (nodes.get(i)!.id === id) {
        nodes.delete(i);
        break;
      }
    }
    // Drop any edges that reference this node
    const edges = storage.get("edges");
    for (let i = edges.length - 1; i >= 0; i--) {
      const e = edges.get(i)!;
      if (e.source === id || e.target === id) edges.delete(i);
    }
  }, []);

  // ---- handlers referenced from node data --------------------------------

  const onChatFromConcept = useCallback(
    (conceptNodeId: string, concept: { label: string; summary: string; excerpt: string; sourceSlug: string }) => {
      const origin = storedNodes.find((n) => n.id === conceptNodeId);
      const basePos = origin?.position ?? { x: 200, y: 200 };
      addChatForConcept(
        { x: basePos.x + 320, y: basePos.y + 40 },
        user.id,
        concept,
      );
    },
    [storedNodes, addChatForConcept, user.id],
  );

  // Map stored → React Flow nodes
  const rfNodes = useMemo<Node[]>(() => {
    return storedNodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: n.position,
      data: {
        canvasId,
        ...(n.kind === "doc" ? { slug: (n as CanvasNodeDoc).slug } : {}),
        ...(n.kind === "note" ? { body: (n as CanvasNodeNote).body } : {}),
        ...(n.kind === "chat"
          ? {
              threadId: (n as CanvasNodeChat).threadId,
              title: (n as CanvasNodeChat).title,
              attachedSlugs: (n as CanvasNodeChat).attachedSlugs ?? [],
              position: n.position,
            }
          : {}),
        ...(n.kind === "concept"
          ? {
              label: (n as CanvasNodeConcept).label,
              summary: (n as CanvasNodeConcept).summary,
              excerpt: (n as CanvasNodeConcept).excerpt,
              sourceSlug: (n as CanvasNodeConcept).sourceSlug,
              isRoot: (n as CanvasNodeConcept).isRoot,
              onChat: () =>
                onChatFromConcept(n.id, {
                  label: (n as CanvasNodeConcept).label,
                  summary: (n as CanvasNodeConcept).summary,
                  excerpt: (n as CanvasNodeConcept).excerpt,
                  sourceSlug: (n as CanvasNodeConcept).sourceSlug,
                }),
            }
          : {}),
      },
      draggable: true,
    }));
  }, [storedNodes, canvasId, onChatFromConcept]);

  const rfEdges = useMemo<Edge[]>(() => {
    return storedEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "default",
      style: { stroke: "var(--ink-40)", strokeWidth: 1.5 },
    }));
  }, [storedEdges]);

  // ---- listen for canvas-drop tree results -------------------------------

  useEffect(() => {
    const off = onCanvasDropResult((sid, result) => {
      if (result.job.canvasId !== canvasId) return;
      if (result.status === "generating") {
        console.info("[canvas-drop] generating…", sid);
        return;
      }
      // Clear the persistent "Generating…" toast now that we have an outcome
      const toastId = sessionToasts.current.get(sid);
      if (toastId) {
        dismissToast(toastId);
        sessionToasts.current.delete(sid);
      }
      if (result.status === "error") {
        console.error("[canvas-drop] error:", result.message);
        toast(
          `Tree generation failed — ${result.message.slice(0, 240)}`,
          "error",
          15000,
        );
        return;
      }
      // ready
      console.info("[canvas-drop] ready:", {
        root: result.tree.rootLabel,
        nodes: result.tree.nodes.length,
        dropped: result.droppedNodes,
      });

      const rootId = nanoid(8);
      const flat = flattenTree(
        result.tree.rootLabel || result.job.title,
        rootId,
        result.tree.nodes,
      );
      const positions = layoutFlat(flat, result.job.position);

      addConceptTree(flat, positions);

      // Auto-frame the new concept tree so it's impossible to miss
      setTimeout(() => {
        try {
          fitView({
            padding: 0.3,
            duration: 450,
            nodes: flat.map((n) => ({ id: n.id })),
          });
        } catch (err) {
          console.warn("[canvas-drop] fitView failed:", err);
        }
      }, 180);

      if (result.droppedNodes > 0) {
        toast(
          `Tree ready (${result.droppedNodes} node${result.droppedNodes === 1 ? "" : "s"} dropped — excerpt mismatch)`,
          "success",
        );
      } else {
        toast("Tree ready", "success");
      }
    });
    return () => {
      off();
    };
  }, [canvasId, addConceptTree, fitView]);

  // ---- interactions ------------------------------------------------------

  const surfaceRef = useRef<HTMLDivElement>(null);

  const toFlowPos = useCallback(
    (clientX: number, clientY: number): XYPosition => {
      try {
        const p = screenToFlowPosition({ x: clientX, y: clientY });
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          throw new Error("non-finite flow position");
        }
        return p;
      } catch {
        const rect = surfaceRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return { x: clientX - rect.left - 120, y: clientY - rect.top - 24 };
      }
    },
    [screenToFlowPosition],
  );

  // Generate a tree from raw markdown at a flow position.
  // Keeps a persistent "Generating…" toast open (click to dismiss, or auto-
  // cleared on tree.ready / tree.error) so long Claude calls stay visible.
  const generateTreeFromText = useCallback(
    (title: string, body: string, position: XYPosition) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      const slug = `paste-${nanoid(6)}`;
      console.info("[canvas-drop] firing", {
        title,
        bodyLength: trimmed.length,
        canvasId,
        position,
      });
      const sid = generateCanvasDrop({
        source: { slug, title, body: trimmed },
        canvasId,
        position,
        title,
      });
      if (!sid) {
        toast("Bridge offline — start studio-bridge and retry.", "error", 15000);
        return;
      }
      const toastId = toast(
        `Generating tree from "${title}"… (click to dismiss)`,
        "info",
        0, // persistent until cleared on ready/error
      );
      sessionToasts.current.set(sid, toastId);
    },
    [canvasId, generateCanvasDrop],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const pos = toFlowPos(e.clientX, e.clientY);

      // 1) Drop of a workspace doc chip → place as DocCard
      const docData = e.dataTransfer.getData("application/x-oxflow-doc");
      if (docData) {
        try {
          const { slug } = JSON.parse(docData) as { slug: string };
          addDocAt(slug, pos);
        } catch {
          /* ignore */
        }
        return;
      }

      // 2) Drop of .md file(s) from Finder → import to workspace (drawer)
      //    AND kick off a tree generation for the first one on the canvas.
      const files = Array.from(e.dataTransfer.files ?? []);
      const mdFiles = files.filter((f) => f.name.toLowerCase().endsWith(".md"));
      if (mdFiles.length > 0) {
        // Import all md files so they show up in the drawer
        importFiles(mdFiles).catch((err) => {
          console.error("[canvas-drop] import failed:", err);
        });
        // Use the first as the tree-gen source
        const md = mdFiles[0];
        md
          .text()
          .then((text) => {
            const title = md.name.replace(/\.md$/i, "");
            generateTreeFromText(title, text, pos);
          })
          .catch((err) => {
            toast(`Couldn't read ${md.name}: ${String(err)}`, "error", 10000);
          });
        return;
      }

      // 3) Plain text drop
      const text = e.dataTransfer.getData("text/plain");
      if (text && text.trim().length > 20) {
        generateTreeFromText("Dropped text", text, pos);
      }
    },
    [addDocAt, toFlowPos, generateTreeFromText, importFiles],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    const t = e.dataTransfer.types;
    if (
      t.includes("application/x-oxflow-doc") ||
      t.includes("Files") ||
      t.includes("text/plain")
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  // Batch position commits
  const dragDraft = useRef<Record<string, XYPosition>>({});
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, rfNodes);
      for (const c of changes) {
        if (c.type === "position" && c.position && !c.dragging) {
          dragDraft.current[c.id] = c.position;
        } else if (c.type === "position" && c.position && c.dragging) {
          dragDraft.current[c.id] = c.position;
        } else if (c.type === "remove") {
          removeNode(c.id);
        }
      }
      if (changes.some((c) => c.type === "position" && c.dragging === false)) {
        const toCommit = { ...dragDraft.current };
        dragDraft.current = {};
        if (Object.keys(toCommit).length > 0) commitPositions(toCommit);
      }
      return next;
    },
    [rfNodes, removeNode, commitPositions],
  );

  const onPaneDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.closest(".react-flow__pane")) return;
      addChat(toFlowPos(e.clientX, e.clientY), user.id);
    },
    [addChat, toFlowPos, user.id],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = toFlowPos(e.clientX, e.clientY);
      updateMyPresence({ cursor: pos });
    },
    [toFlowPos, updateMyPresence],
  );

  const onMouseLeave = useCallback(() => {
    updateMyPresence({ cursor: null });
  }, [updateMyPresence]);

  // Paste: spawn a tree from clipboard markdown at viewport center
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPaste = (e: ClipboardEvent) => {
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "TEXTAREA" ||
          active.tagName === "INPUT" ||
          (active as HTMLElement).isContentEditable)
      ) {
        return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text.trim() || text.trim().length < 20) return;
      e.preventDefault();
      const rect = surfaceRef.current?.getBoundingClientRect();
      const centerX = rect ? rect.left + rect.width / 2 : 400;
      const centerY = rect ? rect.top + rect.height / 2 : 300;
      const pos = toFlowPos(centerX, centerY);
      const firstLine = text.split("\n").find((l) => l.trim()) ?? "Pasted text";
      const title = firstLine.replace(/^#+\s*/, "").slice(0, 60) || "Pasted text";
      generateTreeFromText(title, text, pos);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [toFlowPos, generateTreeFromText]);

  // Keyboard shortcuts
  const ready = nodesStorage !== undefined && nodesStorage !== null;
  useEffect(() => {
    if (typeof window === "undefined" || !ready) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea")) return;
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        addNote({ x: 120, y: 120 });
      } else if (
        e.key.toLowerCase() === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        addChat({ x: 200, y: 200 }, user.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready, addNote, addChat, user.id]);

  return (
    <section className="canvas-surface" ref={surfaceRef}>
      <CanvasTitleBar canvasId={canvasId} />

      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          display: "flex",
          gap: 6,
          zIndex: 20,
        }}
      >
        <button
          className="btn btn-sm"
          onClick={() => addNote({ x: 120, y: 120 })}
          title="Add a sticky note (shortcut: N)"
        >
          <StickyNote size={13} />
          Note
        </button>
        <button
          className="btn btn-sm"
          onClick={() => addChat({ x: 200, y: 200 }, user.id)}
          title="Add a Claude chat bubble (shortcut: C, or double-click the canvas)"
        >
          <MessagesSquare size={13} />
          Chat
        </button>
      </div>

      {storedNodes.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          <div
            style={{
              padding: "1.1rem 1.3rem",
              borderRadius: "var(--radius)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--ink-60)",
              fontSize: "0.85rem",
              maxWidth: 440,
              lineHeight: 1.6,
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <div style={{ fontWeight: 500, color: "var(--ink)", marginBottom: 6 }}>
              Empty canvas
            </div>
            Drop an <kbd style={kbdStyle}>.md</kbd> file on the canvas — or paste
            markdown with <kbd style={kbdStyle}>⌘V</kbd> — to expand it into a
            concept tree of individual nodes. Double-click for a chat bubble.
            Press <kbd style={kbdStyle}>N</kbd> for a note. Click Chat on any
            concept to query just that branch.
          </div>
        </div>
      )}

      {/* Presence cursors */}
      {others.map((other) =>
        other.presence.cursor ? (
          <div
            key={other.connectionId}
            style={{
              position: "absolute",
              transform: `translate3d(${other.presence.cursor.x}px, ${other.presence.cursor.y}px, 0)`,
              pointerEvents: "none",
              zIndex: 30,
              fontSize: 11,
              color: "#fff",
              background: other.presence.color ?? "#10B981",
              padding: "2px 6px",
              borderRadius: 999,
              whiteSpace: "nowrap",
            }}
          >
            {other.presence.name || "anon"}
          </div>
        ) : null,
      )}

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onDoubleClick={onPaneDoubleClick}
        style={{ width: "100%", height: "100%" }}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView={rfNodes.length > 0}
          minZoom={0.2}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
          nodeOrigin={[0, 0]}
        >
          <Background color="#c8c8c8" gap={24} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#ddd" maskColor="rgba(250,250,250,0.7)" />
        </ReactFlow>
      </div>
    </section>
  );
}

