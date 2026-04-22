"use client";

import {
  createClient,
  LiveList,
  LiveMap,
  LiveObject,
  type JsonObject,
  type LsonObject,
} from "@liveblocks/client";
import { createRoomContext } from "@liveblocks/react";

// ===========================================================================
// Liveblocks client
// ===========================================================================

const liveblocksPublicKey =
  process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY ?? "";

export const liveblocksClient = createClient({
  // If the public key is set we use it directly. Otherwise fall through to
  // the auth endpoint below — handles secret-key-only deployments cleanly.
  ...(liveblocksPublicKey
    ? { publicApiKey: liveblocksPublicKey }
    : { authEndpoint: "/api/liveblocks-auth" }),
  throttle: 16,
});

// ===========================================================================
// Presence (shared across both room types)
// ===========================================================================

export type Presence = {
  cursor: { x: number; y: number } | null;
  name: string;
  color: string;
  selectedNode: string | null;
};

export const defaultPresence: Presence = {
  cursor: null,
  name: "",
  color: "#10B981",
  selectedNode: null,
};

// ===========================================================================
// Types written into storage
// ===========================================================================

// Heading: all fields are JSON scalars — Liveblocks-compatible when arrays of.
export type Heading = {
  level: number; // 2 | 3
  text: string;
  anchor: string;
};

// DocRecord uses JsonObject for frontmatter so it satisfies LsonObject's
// index signature. All other fields are plain JSON primitives.
export type DocRecord = {
  slug: string;
  title: string;
  frontmatter: JsonObject;
  body: string;
  outboundLinks: string[];
  brRefs: string[];
  headings: Heading[];
  importedBy: string;
  importedAt: number;
  bytes: number;
};

export type CanvasNodeDoc = {
  id: string;
  kind: "doc";
  position: { x: number; y: number };
  slug: string;
};

export type CanvasNodeNote = {
  id: string;
  kind: "note";
  position: { x: number; y: number };
  body: string;
};

export type CanvasNodeChat = {
  id: string;
  kind: "chat";
  position: { x: number; y: number };
  threadId: string;
  title: string;
  ownerUserId: string;
  attachedSlugs?: string[]; // doc slugs attached to this chat for synthesis
};

export type GeneratedNodeJson = {
  id: string;
  label: string;
  summary: string;
  excerpt: string;
  sourceSlug: string;
  children?: GeneratedNodeJson[];
};

export type GeneratedTree = {
  kind: "per-doc" | "synthesis";
  rootLabel: string;
  sourceSlugs: string[];
  focusPrompt: string | null;
  generatedAt: number;
  generatedBy: string;
  status: "pending" | "generating" | "ready" | "error";
  errorMessage: string | null;
  nodes: GeneratedNodeJson[];
};

export type CanvasNodeConcept = {
  id: string;
  kind: "concept";
  position: { x: number; y: number };
  rootId: string; // groups all concepts from the same tree drop
  isRoot: boolean;
  label: string;
  summary: string;
  excerpt: string; // empty for root
  sourceSlug: string; // empty for root
};

export type CanvasNode =
  | CanvasNodeDoc
  | CanvasNodeNote
  | CanvasNodeChat
  | CanvasNodeConcept;

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  streaming?: boolean;
};

export type CanvasMeta = {
  id: string;
  title: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
};

// ===========================================================================
// Room contexts
// ===========================================================================

// Workspace room — one per team. Holds imported docs + canvas directory.
export type WorkspaceStorage = {
  docs: LiveMap<string, LiveObject<DocRecord>>;
  canvases: LiveMap<string, LiveObject<CanvasMeta>>;
};

export const {
  RoomProvider: WorkspaceRoomProvider,
  useRoom: useWorkspaceRoom,
  useSelf: useWorkspaceSelf,
  useOthers: useWorkspaceOthers,
  useStorage: useWorkspaceStorage,
  useMutation: useWorkspaceMutation,
  useBroadcastEvent: useWorkspaceBroadcast,
  useEventListener: useWorkspaceEventListener,
} = createRoomContext<Presence, WorkspaceStorage>(liveblocksClient);

// Canvas room — one per canvas.
export type CanvasStorage = {
  nodes: LiveList<CanvasNode>;
  edges: LiveList<CanvasEdge>;
  chatThreads: LiveMap<string, LiveList<ChatMessage>>;
  meta: LiveObject<CanvasMeta>;
};

export const {
  RoomProvider: CanvasRoomProvider,
  useRoom: useCanvasRoom,
  useSelf: useCanvasSelf,
  useOthers: useCanvasOthers,
  useStorage: useCanvasStorage,
  useMutation: useCanvasMutation,
  useBroadcastEvent: useCanvasBroadcast,
  useEventListener: useCanvasEventListener,
  useUpdateMyPresence: useCanvasUpdateMyPresence,
} = createRoomContext<Presence, CanvasStorage>(liveblocksClient);

// ===========================================================================
// Initial storage factories
// ===========================================================================

export function buildWorkspaceInitialStorage(): WorkspaceStorage {
  return {
    docs: new LiveMap(),
    canvases: new LiveMap(),
  } as unknown as WorkspaceStorage;
}

export function buildCanvasInitialStorage(
  id: string,
  workspaceId: string,
  title = "Untitled canvas",
): CanvasStorage {
  const now = Date.now();
  return {
    nodes: new LiveList([]),
    edges: new LiveList([]),
    chatThreads: new LiveMap(),
    meta: new LiveObject({
      id,
      title,
      workspaceId,
      createdAt: now,
      updatedAt: now,
    }),
  } as unknown as CanvasStorage;
}

// ===========================================================================
// Helpers
// ===========================================================================

export function workspaceRoomId(id: string) {
  return `oxflow-studio:workspace:${id}`;
}

export function canvasRoomId(id: string) {
  return `oxflow-studio:canvas:${id}`;
}

export const USER_COLORS = [
  "#10B981",
  "#2563EB",
  "#7C3AED",
  "#D97706",
  "#DC2626",
  "#0EA5E9",
  "#EC4899",
  "#14B8A6",
];

export function pickUserColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}
