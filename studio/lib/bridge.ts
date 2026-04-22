"use client";

import { nanoid } from "nanoid";

export type BridgeStatus = "idle" | "connecting" | "connected" | "error";

export type TreeGenSource = {
  slug: string;
  title: string;
  body: string;
};

export type TreeGenResult = {
  rootLabel: string;
  nodes: {
    id: string;
    label: string;
    summary: string;
    excerpt: string;
    sourceSlug: string;
    children?: unknown[];
  }[];
};

export type BridgeInbound =
  | { type: "hello"; bridgeVersion: string; sessionsDir: string }
  | { type: "chat.delta"; sessionId: string; delta: string }
  | { type: "chat.done"; sessionId: string }
  | { type: "session.saved"; sessionId: string; path: string }
  | { type: "tree.status"; sessionId: string; status: "generating" }
  | {
      type: "tree.ready";
      sessionId: string;
      tree: TreeGenResult;
      droppedNodes: number;
    }
  | { type: "tree.error"; sessionId: string; message: string }
  | { type: "error"; sessionId?: string; message: string };

export type BridgeOutbound =
  | {
      type: "chat.start";
      sessionId: string;
      systemPrompt: string;
      userMessage: string;
      history?: { role: "user" | "assistant"; content: string }[];
    }
  | { type: "chat.cancel"; sessionId: string }
  | {
      type: "session.close";
      sessionId: string;
      title?: string;
      contextDocs?: string[];
      history: { role: "user" | "assistant"; content: string }[];
    }
  | {
      type: "tree.generate";
      sessionId: string;
      kind: "per-doc" | "synthesis";
      focusPrompt: string | null;
      sources: TreeGenSource[];
    };

type Listener = (msg: BridgeInbound) => void;
type StatusListener = (status: BridgeStatus) => void;

class BridgeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private status: BridgeStatus = "idle";
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private reconnectTimer: number | null = null;
  private attempt = 0;
  private explicitlyClosed = false;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (typeof window === "undefined") return;
    if (this.ws) return;
    this.explicitlyClosed = false;
    this.setStatus("connecting");
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.setStatus("error");
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("connected");
    };
    this.ws.onclose = () => {
      this.ws = null;
      if (!this.explicitlyClosed) {
        this.setStatus("error");
        this.scheduleReconnect();
      }
    };
    this.ws.onerror = () => {
      this.setStatus("error");
    };
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as BridgeInbound;
        for (const fn of this.listeners) fn(msg);
      } catch {
        /* ignore */
      }
    };
  }

  disconnect() {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus("idle");
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const backoff = Math.min(10000, 500 * Math.pow(2, this.attempt));
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, backoff);
  }

  send(msg: BridgeOutbound) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  onMessage(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: StatusListener) {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  getStatus() {
    return this.status;
  }

  private setStatus(s: BridgeStatus) {
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }
}

let _instance: BridgeClient | null = null;

export function getBridge(): BridgeClient {
  if (_instance) return _instance;
  const url =
    typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_BRIDGE_URL ?? "ws://localhost:4456")
      : "ws://localhost:4456";
  _instance = new BridgeClient(url);
  return _instance;
}

export function newSessionId() {
  return `s_${nanoid(10)}`;
}
