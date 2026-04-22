"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { LiveList } from "@liveblocks/client";
import {
  MessagesSquare,
  Send,
  Save,
  Network,
  XCircle,
  X as XIcon,
} from "lucide-react";
import { NodeDeleteButton } from "./NodeChrome";
import { useTreeGenerator, onSynthesisResult, docToSource } from "../useTreeGenerator";
import type {
  CanvasNodeChat,
  CanvasNodeConcept,
  CanvasEdge,
} from "@/lib/liveblocks";
import { useWorkspaceStorage } from "@/lib/liveblocks";
import { nanoid } from "nanoid";
import {
  useCanvasMutation,
  useCanvasStorage,
  type ChatMessage,
} from "@/lib/liveblocks";
import { flattenTree, layoutFlat } from "@/lib/conceptLayout";
import { getBridge, newSessionId, type BridgeInbound } from "@/lib/bridge";
import { useDocs } from "../useDocs";
import { toast } from "@/lib/toast";

type Data = {
  canvasId: string;
  threadId: string;
  title: string;
  attachedSlugs: string[];
  position: { x: number; y: number };
};

function ChatBubbleNodeInner({ id, data, selected }: NodeProps) {
  const { canvasId, threadId, title, attachedSlugs, position } = data as Data;
  const threads = useCanvasStorage((root) => root.chatThreads);
  const allDocs = useDocs();
  const workspaceDocs = useWorkspaceStorage((root) => root.docs);
  const { generateSynthesis } = useTreeGenerator();
  const [mode, setMode] = useState<"chat" | "tree">("chat");
  const [treeBusy, setTreeBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const messages = useMemo<ChatMessage[]>(() => {
    const t = threads?.get(threadId);
    if (!t) return [];
    const out: ChatMessage[] = [];
    for (const m of t as unknown as Iterable<ChatMessage>) out.push(m);
    return out;
  }, [threads, threadId]);

  const [input, setInput] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const msgListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (msgListRef.current) {
      msgListRef.current.scrollTop = msgListRef.current.scrollHeight;
    }
  }, [messages, streamingId]);

  const ensureThread = useCanvasMutation(({ storage }, tid: string) => {
    const map = storage.get("chatThreads");
    if (!map.get(tid)) map.set(tid, new LiveList([]));
  }, []);

  const pushMessage = useCanvasMutation(
    ({ storage }, tid: string, msg: ChatMessage) => {
      const map = storage.get("chatThreads");
      let list = map.get(tid);
      if (!list) {
        list = new LiveList([]);
        map.set(tid, list);
      }
      list.push(msg);
    },
    [],
  );

  const updateMessage = useCanvasMutation(
    (
      { storage },
      tid: string,
      msgId: string,
      patch: Partial<ChatMessage>,
    ) => {
      const list = storage.get("chatThreads").get(tid);
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const m = list.get(i)!;
        if (m.id !== msgId) continue;
        list.set(i, { ...m, ...patch });
        break;
      }
    },
    [],
  );

  const renameThread = useCanvasMutation(
    ({ storage }, nodeId: string, nextTitle: string) => {
      const nodes = storage.get("nodes");
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes.get(i)!;
        if (n.id !== nodeId) continue;
        if (n.kind !== "chat") return;
        nodes.set(i, { ...n, title: nextTitle });
        break;
      }
    },
    [],
  );

  const setAttachedSlugs = useCanvasMutation(
    ({ storage }, nodeId: string, next: string[]) => {
      const nodes = storage.get("nodes");
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes.get(i)!;
        if (n.id !== nodeId) continue;
        if (n.kind !== "chat") return;
        nodes.set(i, { ...(n as CanvasNodeChat), attachedSlugs: next });
        break;
      }
    },
    [],
  );

  const addConceptTreeNearby = useCanvasMutation(
    (
      { storage },
      origin: { x: number; y: number },
      rootLabel: string,
      generatedNodes: Parameters<typeof flattenTree>[2],
    ) => {
      const rootId = nanoid(8);
      const flat = flattenTree(rootLabel, rootId, generatedNodes);
      const positions = layoutFlat(flat, {
        x: origin.x + 420,
        y: origin.y,
      });
      const nodes = storage.get("nodes");
      const edges = storage.get("edges");
      for (const n of flat) {
        const pos = positions.get(n.id) ?? origin;
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
        } as CanvasEdge);
      }
    },
    [],
  );

  // Bridge streaming -------------------------------------------------------
  useEffect(() => {
    if (!sessionId) return;
    const bridge = getBridge();
    const off = bridge.onMessage((msg: BridgeInbound) => {
      if ("sessionId" in msg && msg.sessionId !== sessionId) return;
      if (msg.type === "chat.delta" && streamingId) {
        // Append delta to the streaming assistant message
        const existing = messages.find((m) => m.id === streamingId);
        if (existing) {
          updateMessage(threadId, streamingId, {
            content: existing.content + msg.delta,
          });
        }
      } else if (msg.type === "chat.done") {
        if (streamingId) {
          updateMessage(threadId, streamingId, { streaming: false });
        }
        setStreamingId(null);
        setSessionId(null);
      } else if (msg.type === "error") {
        toast(msg.message, "error");
        if (streamingId) {
          updateMessage(threadId, streamingId, {
            streaming: false,
            content:
              (messages.find((m) => m.id === streamingId)?.content ?? "") +
              `\n\n[error: ${msg.message}]`,
          });
        }
        setStreamingId(null);
        setSessionId(null);
      } else if (msg.type === "session.saved") {
        toast(`Session saved to ${msg.path}`, "success");
      }
    });
    return () => {
      off();
    };
  }, [sessionId, streamingId, messages, threadId, updateMessage]);

  // Listen for synthesis results targeted at THIS chat bubble
  useEffect(() => {
    const off = onSynthesisResult((_sid, result) => {
      if (result.job.chatThreadId !== threadId) return;
      if (result.status === "generating") {
        setTreeBusy(true);
      } else if (result.status === "ready") {
        setTreeBusy(false);
        const rootLabel =
          result.job.focusPrompt ?? result.tree.rootLabel ?? "Synthesis";
        addConceptTreeNearby(position, rootLabel, result.tree.nodes);
        if (result.droppedNodes > 0) {
          toast(
            `Synthesis tree ready (${result.droppedNodes} node${result.droppedNodes === 1 ? "" : "s"} dropped — excerpt mismatch)`,
            "success",
          );
        } else {
          toast("Synthesis tree ready", "success");
        }
      } else if (result.status === "error") {
        setTreeBusy(false);
        toast(`Synthesis failed — ${result.message.slice(0, 120)}`, "error");
      }
    });
    return () => {
      off();
    };
  }, [threadId, position, addConceptTreeNearby]);

  // Accept doc drops from the drawer — attach the slug if not already attached
  const onAttachDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const raw = e.dataTransfer.getData("application/x-oxflow-doc");
      if (!raw) return;
      try {
        const { slug } = JSON.parse(raw) as { slug: string };
        if (attachedSlugs.includes(slug)) return;
        setAttachedSlugs(id, [...attachedSlugs, slug]);
      } catch {
        /* ignore */
      }
    },
    [attachedSlugs, setAttachedSlugs, id],
  );

  const onAttachDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-oxflow-doc")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, []);

  const onAttachDragLeave = useCallback(() => setDragOver(false), []);

  const detachSlug = (slug: string) => {
    setAttachedSlugs(
      id,
      attachedSlugs.filter((s) => s !== slug),
    );
  };

  // Run synthesis against attached docs
  const generateTree = useCallback(() => {
    if (treeBusy) return;
    if (attachedSlugs.length === 0) {
      toast("Attach at least one doc by dragging from the drawer", "error");
      return;
    }
    const sources = attachedSlugs
      .map((s) => workspaceDocs?.get(s))
      .filter(Boolean)
      .map((d) => docToSource(d as unknown as Parameters<typeof docToSource>[0]));

    if (sources.length === 0) {
      toast("Attached docs are missing from workspace", "error");
      return;
    }

    const focusPrompt = input.trim() || null;
    setTreeBusy(true);
    const sid = generateSynthesis({
      canvasId,
      chatThreadId: threadId,
      sources,
      focusPrompt,
      title: focusPrompt ?? "Synthesis tree",
    });
    if (!sid) {
      setTreeBusy(false);
      toast("Bridge offline — start studio-bridge and retry", "error");
      return;
    }
    setInput("");
  }, [treeBusy, attachedSlugs, workspaceDocs, input, generateSynthesis, canvasId, threadId]);

  // Build system prompt from the current workspace doc titles
  const systemPrompt = useMemo(() => {
    const docSummary = allDocs
      .slice(0, 30)
      .map((d) => `- [[${d.slug}]] ${d.title}`)
      .join("\n");
    return `You are a helpful research assistant inside oxFlow Studio. The user is exploring a research corpus; the following docs are currently in the workspace:\n\n${docSummary}\n\nAnswer concisely, cite docs using [[slug]] notation and business rules as BR-XXX when appropriate.`;
  }, [allDocs]);

  const send = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || streamingId) return;

    ensureThread(threadId);

    const userMsg: ChatMessage = {
      id: nanoid(10),
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };
    pushMessage(threadId, userMsg);

    // Give the bubble a human-readable title from first user turn
    if (messages.length === 0 && title === "New chat") {
      const t = prompt.length > 40 ? prompt.slice(0, 40).trim() + "…" : prompt;
      renameThread(id, t);
    }

    const assistantId = nanoid(10);
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      streaming: true,
    };
    pushMessage(threadId, assistantMsg);
    setStreamingId(assistantId);

    const bridge = getBridge();
    const sid = newSessionId();
    setSessionId(sid);

    const history = messages.map((m) => ({
      role: m.role === "system" ? "user" : (m.role as "user" | "assistant"),
      content: m.content,
    }));

    const sent = bridge.send({
      type: "chat.start",
      sessionId: sid,
      systemPrompt,
      userMessage: prompt,
      history,
    });

    if (!sent) {
      updateMessage(threadId, assistantId, {
        streaming: false,
        content:
          "Bridge offline. Start the studio-bridge in a terminal:\n\n  cd studio-bridge && npm install && npm start\n\nthen try again.",
      });
      setStreamingId(null);
      setSessionId(null);
    }

    setInput("");
  }, [
    input,
    streamingId,
    ensureThread,
    threadId,
    pushMessage,
    messages,
    title,
    renameThread,
    id,
    systemPrompt,
    updateMessage,
  ]);

  const cancel = useCallback(() => {
    if (!sessionId) return;
    getBridge().send({ type: "chat.cancel", sessionId });
    if (streamingId) {
      updateMessage(threadId, streamingId, { streaming: false });
    }
    setStreamingId(null);
    setSessionId(null);
  }, [sessionId, streamingId, updateMessage, threadId]);

  const saveSession = useCallback(() => {
    if (messages.length === 0) return;
    const sid = newSessionId();
    const sent = getBridge().send({
      type: "session.close",
      sessionId: sid,
      title,
      history: messages.map((m) => ({
        role: m.role === "system" ? "user" : (m.role as "user" | "assistant"),
        content: m.content,
      })),
    });
    if (!sent) toast("Bridge offline — can't save session", "error");
    else toast("Saving session…");
  }, [messages, title]);

  return (
    <div
      className={`cnode cnode--chat ${selected ? "selected" : ""}`}
      onDrop={onAttachDrop}
      onDragOver={onAttachDragOver}
      onDragLeave={onAttachDragLeave}
    >
      <NodeDeleteButton id={id} />
      <div className="cnode__head">
        <MessagesSquare size={13} style={{ color: "var(--purple)" }} />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
      </div>
      <div className={`chat-attached ${dragOver ? "dragover" : ""}`}>
        {attachedSlugs.length === 0 ? (
          <span style={{ color: "var(--ink-40)" }}>
            Drag docs here to attach for tree synthesis
          </span>
        ) : (
          attachedSlugs.map((slug) => {
            const doc = allDocs.find((d) => d.slug === slug);
            return (
              <span key={slug} className="chat-attached__chip">
                <span title={slug}>{doc?.title ?? slug}</span>
                <button onClick={() => detachSlug(slug)} title="Detach">
                  <XIcon size={10} />
                </button>
              </span>
            );
          })
        )}
      </div>
      <div className="cnode__messages nodrag" ref={msgListRef}>
        {(() => {
          const seed = messages.find((m) => m.role === "system");
          const visible = messages.filter((m) => m.role !== "system");
          return (
            <>
              {seed && (
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--ink-60)",
                    background: "var(--ink-05)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "0.45rem 0.6rem",
                    marginBottom: "0.4rem",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                  }}
                  title="Context seeded when this chat was opened from a tree branch"
                >
                  {seed.content.split("\n\n")[0]}
                </div>
              )}
              {visible.length === 0 && !seed && (
                <div style={{ fontSize: "0.82rem", color: "var(--ink-40)", lineHeight: 1.55 }}>
                  Type a question. Claude will answer using the docs currently in
                  your workspace.
                </div>
              )}
              {visible.length === 0 && seed && (
                <div style={{ fontSize: "0.82rem", color: "var(--ink-40)", lineHeight: 1.55 }}>
                  Ask anything about this branch.
                </div>
              )}
              {visible.map((m) => (
                <div key={m.id} className={`msg msg--${m.role}`}>
                  <div className="msg__role">{m.role === "user" ? "you" : "claude"}</div>
                  <div className={`msg__body ${m.streaming ? "msg__body--streaming" : ""}`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </>
          );
        })()}
      </div>
      <div className="cnode__input nodrag">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (mode === "tree") generateTree();
              else send();
            }
          }}
          placeholder={
            mode === "tree"
              ? attachedSlugs.length === 0
                ? "Drag docs above, then describe the concept (optional)…"
                : "Concept focus (optional) — e.g. 'compare PBA and SPA'"
              : "Ask anything about the docs in your workspace…"
          }
          rows={1}
        />
        {mode === "chat" ? (
          streamingId ? (
            <button className="btn btn-sm" onClick={cancel} title="Cancel">
              <XCircle size={13} />
            </button>
          ) : (
            <button
              className="btn btn-sm btn-accent"
              onClick={send}
              title="Send message to Claude"
            >
              <Send size={13} />
            </button>
          )
        ) : treeBusy ? (
          <button className="btn btn-sm" disabled title="Generating…">
            <Network size={13} />
          </button>
        ) : (
          <button
            className="btn btn-sm btn-accent"
            onClick={generateTree}
            disabled={attachedSlugs.length === 0}
            title={
              attachedSlugs.length === 0
                ? "Attach at least one doc first"
                : "Generate a concept tree from the attached docs"
            }
          >
            <Network size={13} />
          </button>
        )}
      </div>
      <div className="cnode__footer-bar">
        <div
          style={{
            display: "inline-flex",
            gap: 0,
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: 999,
            padding: 2,
          }}
        >
          <button
            onClick={() => setMode("chat")}
            className="nodrag"
            title="Conversational chat mode"
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: "0.7rem",
              fontWeight: 500,
              color: mode === "chat" ? "var(--white)" : "var(--ink-60)",
              background: mode === "chat" ? "var(--ink)" : "transparent",
            }}
          >
            Chat
          </button>
          <button
            onClick={() => setMode("tree")}
            className="nodrag"
            title="Generate a concept tree from attached docs"
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: "0.7rem",
              fontWeight: 500,
              color: mode === "tree" ? "var(--white)" : "var(--ink-60)",
              background: mode === "tree" ? "var(--purple)" : "transparent",
            }}
          >
            Tree
          </button>
        </div>
        <span className="spacer" />
        <button
          className="btn btn-sm btn-ghost nodrag"
          onClick={saveSession}
          title="Save session to ~/Desktop/oxflow-studio/sessions/"
        >
          <Save size={12} /> Save
        </button>
      </div>
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

export const ChatBubbleNode = memo(ChatBubbleNodeInner);
