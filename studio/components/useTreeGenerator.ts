"use client";

import { useCallback, useEffect } from "react";
import type { DocRecord, GeneratedNodeJson } from "@/lib/liveblocks";
import {
  getBridge,
  type BridgeInbound,
  type TreeGenSource,
} from "@/lib/bridge";
import { useStudioUser } from "./RoomProviders";

// ============================================================================
// Module-scope pending-job registry.
//
// Tree generations started from a canvas node may complete after the caller
// has unmounted. Jobs live at module scope so whichever TreeGeneratorHost
// instance is currently mounted can route the result into the right channel.
// ============================================================================

type SynthesisJob = {
  kind: "synthesis";
  canvasId: string;
  chatThreadId: string;
  sourceSlugs: string[];
  userId: string;
  focusPrompt: string | null;
  title: string;
};

type CanvasDropJob = {
  kind: "canvas-drop";
  canvasId: string;
  position: { x: number; y: number };
  userId: string;
  title: string;
  focusPrompt: string | null;
};

type PendingJob = SynthesisJob | CanvasDropJob;

const PENDING = new Map<string, PendingJob>();

type SynthesisResult =
  | { status: "generating"; job: SynthesisJob }
  | {
      status: "ready";
      job: SynthesisJob;
      tree: { rootLabel: string; nodes: GeneratedNodeJson[] };
      droppedNodes: number;
    }
  | { status: "error"; job: SynthesisJob; message: string };

type CanvasDropResult =
  | { status: "generating"; job: CanvasDropJob }
  | {
      status: "ready";
      job: CanvasDropJob;
      tree: { rootLabel: string; nodes: GeneratedNodeJson[] };
      droppedNodes: number;
    }
  | { status: "error"; job: CanvasDropJob; message: string };

type SynthesisListener = (sessionId: string, result: SynthesisResult) => void;
type CanvasDropListener = (sessionId: string, result: CanvasDropResult) => void;

const SYNTHESIS_LISTENERS = new Set<SynthesisListener>();
const CANVAS_DROP_LISTENERS = new Set<CanvasDropListener>();

export function onSynthesisResult(fn: SynthesisListener): () => void {
  SYNTHESIS_LISTENERS.add(fn);
  return () => {
    SYNTHESIS_LISTENERS.delete(fn);
  };
}

export function onCanvasDropResult(fn: CanvasDropListener): () => void {
  CANVAS_DROP_LISTENERS.add(fn);
  return () => {
    CANVAS_DROP_LISTENERS.delete(fn);
  };
}

// ============================================================================
// TreeGeneratorHost — mount once (in the layout) to dispatch bridge tree.*
// messages into the appropriate listener channel.
// ============================================================================

export function TreeGeneratorHost() {
  useEffect(() => {
    const bridge = getBridge();
    const off = bridge.onMessage((msg: BridgeInbound) => {
      if (
        msg.type !== "tree.status" &&
        msg.type !== "tree.ready" &&
        msg.type !== "tree.error"
      ) {
        return;
      }
      const job = PENDING.get(msg.sessionId);
      if (!job) return;

      if (job.kind === "synthesis") {
        if (msg.type === "tree.status") {
          for (const fn of SYNTHESIS_LISTENERS) {
            fn(msg.sessionId, { status: "generating", job });
          }
        } else if (msg.type === "tree.ready") {
          PENDING.delete(msg.sessionId);
          for (const fn of SYNTHESIS_LISTENERS) {
            fn(msg.sessionId, {
              status: "ready",
              job,
              tree: {
                rootLabel: msg.tree.rootLabel,
                nodes: msg.tree.nodes as GeneratedNodeJson[],
              },
              droppedNodes: msg.droppedNodes,
            });
          }
        } else if (msg.type === "tree.error") {
          PENDING.delete(msg.sessionId);
          for (const fn of SYNTHESIS_LISTENERS) {
            fn(msg.sessionId, { status: "error", job, message: msg.message });
          }
        }
      } else {
        // canvas-drop
        if (msg.type === "tree.status") {
          for (const fn of CANVAS_DROP_LISTENERS) {
            fn(msg.sessionId, { status: "generating", job });
          }
        } else if (msg.type === "tree.ready") {
          PENDING.delete(msg.sessionId);
          for (const fn of CANVAS_DROP_LISTENERS) {
            fn(msg.sessionId, {
              status: "ready",
              job,
              tree: {
                rootLabel: msg.tree.rootLabel,
                nodes: msg.tree.nodes as GeneratedNodeJson[],
              },
              droppedNodes: msg.droppedNodes,
            });
          }
        } else if (msg.type === "tree.error") {
          PENDING.delete(msg.sessionId);
          for (const fn of CANVAS_DROP_LISTENERS) {
            fn(msg.sessionId, { status: "error", job, message: msg.message });
          }
        }
      }
    });
    return () => {
      off();
    };
  }, []);

  return null;
}

// ============================================================================
// Hook surface for starting generations
// ============================================================================

export function useTreeGenerator() {
  const { user } = useStudioUser();

  const generateSynthesis = useCallback(
    (params: {
      sources: TreeGenSource[];
      canvasId: string;
      chatThreadId: string;
      focusPrompt: string | null;
      title: string;
    }): string | null => {
      const sessionId = `ts_${Date.now().toString(36)}_${randStamp()}`;
      PENDING.set(sessionId, {
        kind: "synthesis",
        canvasId: params.canvasId,
        chatThreadId: params.chatThreadId,
        sourceSlugs: params.sources.map((s) => s.slug),
        userId: user.id,
        focusPrompt: params.focusPrompt,
        title: params.title,
      });
      const bridge = getBridge();
      const sent = bridge.send({
        type: "tree.generate",
        sessionId,
        kind: "synthesis",
        focusPrompt: params.focusPrompt,
        sources: params.sources,
      });
      if (!sent) {
        PENDING.delete(sessionId);
        return null;
      }
      return sessionId;
    },
    [user.id],
  );

  const generateCanvasDrop = useCallback(
    (params: {
      source: TreeGenSource;
      canvasId: string;
      position: { x: number; y: number };
      title: string;
      focusPrompt?: string | null;
    }): string | null => {
      const sessionId = `cd_${Date.now().toString(36)}_${randStamp()}`;
      PENDING.set(sessionId, {
        kind: "canvas-drop",
        canvasId: params.canvasId,
        position: params.position,
        userId: user.id,
        title: params.title,
        focusPrompt: params.focusPrompt ?? null,
      });
      const bridge = getBridge();
      const sent = bridge.send({
        type: "tree.generate",
        sessionId,
        kind: "synthesis",
        focusPrompt: params.focusPrompt ?? null,
        sources: [params.source],
      });
      if (!sent) {
        PENDING.delete(sessionId);
        return null;
      }
      return sessionId;
    },
    [user.id],
  );

  return { generateSynthesis, generateCanvasDrop };
}

export function docToSource(doc: DocRecord): TreeGenSource {
  return {
    slug: doc.slug,
    title: doc.title,
    body: doc.body,
  };
}

function randStamp(): string {
  return Math.random().toString(36).slice(2, 8);
}
