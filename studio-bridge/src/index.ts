#!/usr/bin/env tsx
/**
 * oxflow-studio-bridge
 * ====================
 *
 * Localhost WebSocket server that spawns the user's local `claude` CLI for
 * each canvas chat bubble. No ANTHROPIC_API_KEY needed on this machine —
 * whatever auth the user has set up for Claude Code is reused directly.
 *
 * Per turn, the bridge spawns:
 *
 *     claude -p <prompt> --system-prompt <sp> \
 *       --output-format stream-json --include-partial-messages --verbose \
 *       --model sonnet
 *
 * Parses the line-delimited JSON stream and forwards `text_delta` events
 * to the browser as `chat.delta` WS messages. On completion it sends
 * `chat.done`. On `session.close` it spawns a one-shot summarisation call
 * and writes the result as a markdown file under
 * ~/Desktop/oxflow-studio/sessions/.
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { buildTreePrompt } from "./treePrompt.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.OXFLOW_BRIDGE_PORT ?? 4456);
const HOST = process.env.OXFLOW_BRIDGE_HOST ?? "127.0.0.1";
const MODEL = process.env.OXFLOW_BRIDGE_MODEL ?? "sonnet";
const CLAUDE_BIN = process.env.OXFLOW_BRIDGE_CLAUDE_BIN ?? "claude";
const SESSIONS_DIR =
  process.env.OXFLOW_BRIDGE_SESSIONS ??
  join(homedir(), "Desktop", "oxflow-studio", "sessions");
const ALLOWED_ORIGINS =
  process.env.OXFLOW_BRIDGE_ORIGINS?.split(",") ?? [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
  ];
const VERSION = "0.3.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InboundStart = {
  type: "chat.start";
  sessionId: string;
  systemPrompt: string;
  userMessage: string;
  history?: { role: "user" | "assistant"; content: string }[];
};
type InboundCancel = { type: "chat.cancel"; sessionId: string };
type InboundClose = {
  type: "session.close";
  sessionId: string;
  title?: string;
  contextDocs?: string[];
  history: { role: "user" | "assistant"; content: string }[];
};
type InboundTreeGenerate = {
  type: "tree.generate";
  sessionId: string;
  kind: "per-doc" | "synthesis";
  focusPrompt: string | null;
  sources: { slug: string; title: string; body: string }[];
};

type Inbound =
  | InboundStart
  | InboundCancel
  | InboundClose
  | InboundTreeGenerate;

type OutboundDelta = { type: "chat.delta"; sessionId: string; delta: string };
type OutboundDone = { type: "chat.done"; sessionId: string };
type OutboundSaved = { type: "session.saved"; sessionId: string; path: string };
type OutboundError = { type: "error"; sessionId?: string; message: string };
type OutboundHello = {
  type: "hello";
  bridgeVersion: string;
  sessionsDir: string;
  claudeBin: string;
};
type OutboundTreeStatus = {
  type: "tree.status";
  sessionId: string;
  status: "generating";
};
type OutboundTreeReady = {
  type: "tree.ready";
  sessionId: string;
  tree: { rootLabel: string; nodes: GeneratedNode[] };
  droppedNodes: number;
};
type OutboundTreeError = {
  type: "tree.error";
  sessionId: string;
  message: string;
};
type Outbound =
  | OutboundDelta
  | OutboundDone
  | OutboundSaved
  | OutboundError
  | OutboundHello
  | OutboundTreeStatus
  | OutboundTreeReady
  | OutboundTreeError;

type GeneratedNode = {
  id: string;
  label: string;
  summary: string;
  excerpt: string;
  sourceSlug: string;
  children?: GeneratedNode[];
};

// ---------------------------------------------------------------------------
// HTTP + WS server
// ---------------------------------------------------------------------------

const http = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        ok: true,
        version: VERSION,
        sessionsDir: SESSIONS_DIR,
        claudeBin: CLAUDE_BIN,
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server: http,
  verifyClient: (info, cb) => {
    const origin = info.origin;
    if (!origin) return cb(true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(true);
    try {
      const host = new URL(origin).hostname;
      if (host === "localhost" || host === "127.0.0.1") return cb(true);
      if (host.endsWith(".vercel.app")) return cb(true);
      if (host.endsWith(".3sixtyone.co")) return cb(true);
    } catch {
      /* fall through */
    }
    cb(false, 403, "Origin not allowed");
  },
});

const activeStreams = new Map<string, ChildProcessWithoutNullStreams>();

async function ensureSessionsDir() {
  try {
    await mkdir(SESSIONS_DIR, { recursive: true });
  } catch (err) {
    console.error("Could not create sessions dir:", SESSIONS_DIR, err);
  }
}

wss.on("connection", (ws) => {
  const send = (msg: Outbound) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  send({
    type: "hello",
    bridgeVersion: VERSION,
    sessionsDir: SESSIONS_DIR,
    claudeBin: CLAUDE_BIN,
  });

  ws.on("message", async (raw) => {
    let msg: Inbound;
    try {
      msg = JSON.parse(raw.toString()) as Inbound;
    } catch {
      return;
    }

    if (msg.type === "chat.start") {
      runChat(msg, send);
    } else if (msg.type === "tree.generate") {
      runTreeGenerate(msg, send);
    } else if (msg.type === "chat.cancel") {
      const child = activeStreams.get(msg.sessionId);
      if (child && !child.killed) child.kill("SIGTERM");
      activeStreams.delete(msg.sessionId);
    } else if (msg.type === "session.close") {
      try {
        const path = await writeSessionSummary(msg);
        send({ type: "session.saved", sessionId: msg.sessionId, path });
      } catch (err) {
        send({
          type: "error",
          sessionId: msg.sessionId,
          message: `Could not save session: ${String((err as Error).message ?? err)}`,
        });
      }
    }
  });

  ws.on("close", () => {
    for (const [sid, child] of activeStreams) {
      if (!child.killed) child.kill("SIGTERM");
      activeStreams.delete(sid);
    }
  });
});

// ---------------------------------------------------------------------------
// Chat — spawn claude -p, parse stream-json, forward deltas
// ---------------------------------------------------------------------------

function formatHistory(
  history: { role: "user" | "assistant"; content: string }[],
  latest: string,
): string {
  if (history.length === 0) return latest;
  // Flatten prior turns before the latest user message.
  const lines: string[] = [];
  for (const m of history) {
    const role = m.role === "user" ? "Human" : "Assistant";
    lines.push(`${role}: ${m.content}`);
  }
  lines.push(`Human: ${latest}`);
  lines.push("Assistant:");
  return lines.join("\n\n");
}

function runChat(msg: InboundStart, send: (m: Outbound) => void) {
  const prompt = formatHistory(msg.history ?? [], msg.userMessage);

  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--model",
    MODEL,
  ];

  // Replace Claude Code's default system prompt so we get a clean
  // conversational assistant (no tool-use prompting).
  if (msg.systemPrompt && msg.systemPrompt.trim().length > 0) {
    args.push("--system-prompt", msg.systemPrompt);
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(CLAUDE_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    send({
      type: "error",
      sessionId: msg.sessionId,
      message: `Could not spawn '${CLAUDE_BIN}': ${(err as Error).message}`,
    });
    return;
  }

  activeStreams.set(msg.sessionId, child);

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let sentDone = false;

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line, msg.sessionId, send, () => {
        sentDone = true;
      });
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString("utf8");
  });

  child.on("error", (err) => {
    activeStreams.delete(msg.sessionId);
    send({
      type: "error",
      sessionId: msg.sessionId,
      message: `claude spawn error: ${err.message}`,
    });
  });

  child.on("close", (code, signal) => {
    activeStreams.delete(msg.sessionId);
    // Flush remaining buffer
    if (stdoutBuffer.trim()) {
      handleLine(stdoutBuffer, msg.sessionId, send, () => {
        sentDone = true;
      });
      stdoutBuffer = "";
    }
    if (!sentDone) {
      if (signal === "SIGTERM") {
        send({ type: "chat.done", sessionId: msg.sessionId });
      } else if (code !== 0) {
        const detail = stderrBuffer.trim().slice(-400) || `exit code ${code}`;
        send({ type: "error", sessionId: msg.sessionId, message: detail });
      } else {
        send({ type: "chat.done", sessionId: msg.sessionId });
      }
    }
  });
}

function handleLine(
  line: string,
  sessionId: string,
  send: (m: Outbound) => void,
  markDone: () => void,
) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let evt: {
    type?: string;
    subtype?: string;
    event?: {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    is_error?: boolean;
    result?: string;
  };
  try {
    evt = JSON.parse(trimmed);
  } catch {
    return;
  }

  // Only forward text deltas (ignore system/hook/init/rate_limit chatter)
  if (
    evt.type === "stream_event" &&
    evt.event?.type === "content_block_delta" &&
    evt.event.delta?.type === "text_delta" &&
    typeof evt.event.delta.text === "string"
  ) {
    send({
      type: "chat.delta",
      sessionId,
      delta: evt.event.delta.text,
    });
    return;
  }

  if (evt.type === "result") {
    markDone();
    if (evt.is_error) {
      send({
        type: "error",
        sessionId,
        message: String(evt.result ?? "claude reported an error"),
      });
    } else {
      send({ type: "chat.done", sessionId });
    }
  }
}

// ---------------------------------------------------------------------------
// Tree generation — spawn claude -p with the locked prompt, buffer the
// response, parse JSON, validate excerpts verbatim, emit tree.ready
// ---------------------------------------------------------------------------

function runTreeGenerate(
  msg: InboundTreeGenerate,
  send: (m: Outbound) => void,
) {
  if (msg.sources.length === 0) {
    send({
      type: "tree.error",
      sessionId: msg.sessionId,
      message: "No sources attached — attach at least one .md doc.",
    });
    return;
  }

  const prompt = buildTreePrompt({
    sources: msg.sources,
    focusPrompt: msg.focusPrompt,
  });

  send({ type: "tree.status", sessionId: msg.sessionId, status: "generating" });

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(
      CLAUDE_BIN,
      [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        MODEL,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    send({
      type: "tree.error",
      sessionId: msg.sessionId,
      message: `Could not spawn '${CLAUDE_BIN}': ${(err as Error).message}`,
    });
    return;
  }

  activeStreams.set(msg.sessionId, child);

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let finalText = "";
  let gotResult = false;

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const evt = JSON.parse(t) as {
          type?: string;
          result?: string;
          is_error?: boolean;
        };
        if (evt.type === "result" && typeof evt.result === "string") {
          gotResult = true;
          finalText = evt.result;
        }
      } catch {
        /* non-JSON line; ignore */
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString("utf8");
  });

  child.on("error", (err) => {
    activeStreams.delete(msg.sessionId);
    send({
      type: "tree.error",
      sessionId: msg.sessionId,
      message: `claude spawn error: ${err.message}`,
    });
  });

  child.on("close", (code, signal) => {
    activeStreams.delete(msg.sessionId);
    if (signal === "SIGTERM") {
      send({
        type: "tree.error",
        sessionId: msg.sessionId,
        message: "Cancelled.",
      });
      return;
    }
    if (!gotResult || code !== 0) {
      const detail =
        stderrBuffer.trim().slice(-400) || `claude exit ${code ?? "?"}`;
      send({
        type: "tree.error",
        sessionId: msg.sessionId,
        message: detail,
      });
      return;
    }

    // Parse + validate
    const parsed = parseTreeJson(finalText);
    if (!parsed) {
      send({
        type: "tree.error",
        sessionId: msg.sessionId,
        message: `Could not parse JSON from Claude. First 200 chars: ${finalText
          .slice(0, 200)
          .replace(/\s+/g, " ")}`,
      });
      return;
    }

    const sourceIndex = buildSourceIndex(msg.sources);
    const { nodes, dropped } = validateNodes(parsed.nodes, sourceIndex);

    if (nodes.length === 0) {
      send({
        type: "tree.error",
        sessionId: msg.sessionId,
        message: `Every generated node's excerpt failed verbatim match. Claude may have paraphrased.`,
      });
      return;
    }

    send({
      type: "tree.ready",
      sessionId: msg.sessionId,
      tree: { rootLabel: parsed.rootLabel, nodes },
      droppedNodes: dropped,
    });
  });
}

function parseTreeJson(
  raw: string,
): { rootLabel: string; nodes: UnvalidatedNode[] } | null {
  if (!raw) return null;
  // Strip code fences if the model added them
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  // Find the first '{' and try to parse from there (tolerates leading prose)
  const firstBrace = s.indexOf("{");
  if (firstBrace === -1) return null;
  s = s.slice(firstBrace);
  try {
    const obj = JSON.parse(s) as {
      rootLabel?: unknown;
      nodes?: unknown;
    };
    if (
      typeof obj.rootLabel !== "string" ||
      !Array.isArray(obj.nodes)
    ) {
      return null;
    }
    return {
      rootLabel: obj.rootLabel,
      nodes: obj.nodes as UnvalidatedNode[],
    };
  } catch {
    return null;
  }
}

type UnvalidatedNode = {
  label?: unknown;
  summary?: unknown;
  excerpt?: unknown;
  sourceSlug?: unknown;
  children?: unknown;
};

function buildSourceIndex(
  sources: InboundTreeGenerate["sources"],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sources) {
    out.set(s.slug, normaliseWhitespace(s.body));
  }
  return out;
}

function validateNodes(
  nodes: UnvalidatedNode[],
  sourceIndex: Map<string, string>,
): { nodes: GeneratedNode[]; dropped: number } {
  let dropped = 0;
  const out: GeneratedNode[] = [];

  for (const n of nodes) {
    const result = validateNode(n, sourceIndex);
    if (result.node) {
      out.push(result.node);
    }
    dropped += result.dropped;
  }

  return { nodes: out, dropped };
}

function validateNode(
  n: UnvalidatedNode,
  sourceIndex: Map<string, string>,
): { node: GeneratedNode | null; dropped: number } {
  if (
    typeof n.label !== "string" ||
    typeof n.summary !== "string" ||
    typeof n.excerpt !== "string" ||
    typeof n.sourceSlug !== "string"
  ) {
    return { node: null, dropped: 1 };
  }

  const label = n.label.trim();
  const summary = n.summary.trim();
  const excerpt = n.excerpt.trim();
  const slug = n.sourceSlug.trim();

  if (!label || !summary || !excerpt || !slug) {
    return { node: null, dropped: 1 };
  }

  const body = sourceIndex.get(slug);
  if (!body) {
    return { node: null, dropped: 1 };
  }

  const needle = normaliseWhitespace(excerpt);
  if (!body.includes(needle)) {
    return { node: null, dropped: 1 };
  }

  // Recurse into children
  let childrenResult: { nodes: GeneratedNode[]; dropped: number } = {
    nodes: [],
    dropped: 0,
  };
  if (Array.isArray(n.children)) {
    childrenResult = validateNodes(
      n.children as UnvalidatedNode[],
      sourceIndex,
    );
  }

  return {
    node: {
      id: shortId(),
      label,
      summary,
      excerpt,
      sourceSlug: slug,
      ...(childrenResult.nodes.length > 0
        ? { children: childrenResult.nodes }
        : {}),
    },
    dropped: childrenResult.dropped,
  };
}

function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function shortId(): string {
  return randomBytes(6).toString("base64url");
}

// ---------------------------------------------------------------------------
// Session summary — one-shot claude -p to produce a tl;dr, then write md
// ---------------------------------------------------------------------------

async function writeSessionSummary(msg: InboundClose): Promise<string> {
  await ensureSessionsDir();
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5).replace(":", "");
  const titleSlug =
    (msg.title ?? "chat")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "chat";
  const filename = `${date}-T${time}-${titleSlug}.md`;
  const path = join(SESSIONS_DIR, filename);

  const tldr = await summarise(msg.history).catch(() => null);

  const contextDocsBlock =
    msg.contextDocs && msg.contextDocs.length > 0
      ? `\n## Context docs on canvas\n${msg.contextDocs.map((s) => `- [[${s}]]`).join("\n")}\n`
      : "";

  const body =
    `---\n` +
    `title: "Chat session — ${msg.title ?? titleSlug}"\n` +
    `date: ${date}\n` +
    `type: chat-session\n` +
    `tags: [chat, session-summary]\n` +
    `bmad_source: null\n` +
    `bridge_version: "${VERSION}"\n` +
    `---\n\n` +
    (tldr ? `## Summary\n${tldr}\n\n` : "") +
    contextDocsBlock +
    `\n## Conversation\n\n` +
    msg.history
      .map((m) => `**${m.role === "user" ? "You" : "Claude"}:**\n${m.content.trim()}`)
      .join("\n\n---\n\n") +
    "\n";

  await writeFile(path, body, "utf8");
  return path;
}

function summarise(
  history: { role: "user" | "assistant"; content: string }[],
): Promise<string | null> {
  if (history.length === 0) return Promise.resolve(null);
  const transcript = history
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
  const prompt =
    "Below is a chat transcript. Write a 1-2 sentence summary focused on the substantive conclusion or decision. Be concrete. Don't say 'the user'.\n\n" +
    transcript;

  return new Promise((resolve, reject) => {
    const child = spawn(
      CLAUDE_BIN,
      ["-p", prompt, "--output-format", "text", "--model", MODEL],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim() || null);
      else reject(new Error(err || `summarise exit ${code}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

http.listen(PORT, HOST, () => {
  console.log(`\n[oxflow-studio-bridge] v${VERSION}`);
  console.log(`  listening on   ws://${HOST}:${PORT}`);
  console.log(`  claude binary  ${CLAUDE_BIN}`);
  console.log(`  model          ${MODEL}`);
  console.log(`  sessions dir   ${SESSIONS_DIR}`);
  console.log(`  allowed origin ${ALLOWED_ORIGINS.join(", ")}\n`);
});
