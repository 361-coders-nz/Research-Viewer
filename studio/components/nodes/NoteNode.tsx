"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useCanvasMutation } from "@/lib/liveblocks";
import type { CanvasNodeNote } from "@/lib/liveblocks";
import { NodeDeleteButton } from "./NodeChrome";

type Data = {
  body: string;
};

function NoteNodeInner({ id, data, selected }: NodeProps) {
  const { body: stored } = data as Data;
  const [draft, setDraft] = useState<string>(stored ?? "");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const flushTimer = useRef<number | null>(null);

  // Keep local state in sync if another user types
  useEffect(() => {
    if (document.activeElement !== taRef.current) {
      setDraft(stored ?? "");
    }
  }, [stored]);

  const commit = useCanvasMutation(
    ({ storage }, nextBody: string) => {
      const nodes = storage.get("nodes");
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes.get(i)!;
        if (n.id !== id) continue;
        if (n.kind !== "note") return;
        nodes.set(i, { ...(n as CanvasNodeNote), body: nextBody });
        break;
      }
    },
    [id],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setDraft(next);
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => commit(next), 320);
    },
    [commit],
  );

  const onBlur = useCallback(() => {
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    commit(draft);
  }, [commit, draft]);

  return (
    <div className={`cnode cnode--note ${selected ? "selected" : ""}`}>
      <NodeDeleteButton id={id} />
      <textarea
        ref={taRef}
        className="nodrag"
        value={draft}
        onChange={onChange}
        onBlur={onBlur}
        placeholder="Sticky note — type to write. Drag header to move."
        spellCheck
      />
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

export const NoteNode = memo(NoteNodeInner);
