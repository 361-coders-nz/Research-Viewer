"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MessagesSquare, FileText } from "lucide-react";
import { NodeDeleteButton } from "./NodeChrome";

type Data = {
  label: string;
  summary: string;
  excerpt: string;
  sourceSlug: string;
  isRoot: boolean;
  onChat?: () => void;
};

function ConceptNodeInner({ id, data, selected }: NodeProps) {
  const { label, summary, excerpt, sourceSlug, isRoot, onChat } = data as Data;
  const router = useRouter();

  const openExcerpt = () => {
    if (!sourceSlug || sourceSlug.startsWith("paste-")) return;
    router.push(`/reader/${sourceSlug}?q=${encodeURIComponent(excerpt)}`);
  };

  const excerptInteractive =
    !!sourceSlug && !sourceSlug.startsWith("paste-") && !!excerpt;

  return (
    <div
      className={`cnode cnode--concept ${isRoot ? "cnode--concept-root" : ""} ${
        selected ? "selected" : ""
      }`}
    >
      <NodeDeleteButton id={id} />
      <div className="cnode__head">
        <div className="cnode__title" style={{ fontWeight: 600 }}>
          {label}
        </div>
      </div>
      {summary && (
        <div
          className="cnode__body"
          style={{
            fontSize: "0.82rem",
            color: "var(--ink-60)",
            lineHeight: 1.5,
            padding: "0 0.85rem 0.5rem",
          }}
        >
          {summary}
        </div>
      )}
      {excerpt && (
        <div style={{ padding: "0 0.85rem 0.55rem" }}>
          <button
            className="nodrag"
            onClick={excerptInteractive ? openExcerpt : undefined}
            disabled={!excerptInteractive}
            title={
              excerptInteractive
                ? "Open source with this excerpt highlighted"
                : "Excerpt from pasted text (no source to open)"
            }
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 5,
              width: "100%",
              padding: "6px 8px",
              borderRadius: 5,
              background: "var(--ink-05)",
              color: "var(--ink-80)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem",
              lineHeight: 1.45,
              textAlign: "left",
              cursor: excerptInteractive ? "pointer" : "default",
              border: "1px solid transparent",
              overflow: "hidden",
            }}
            onMouseEnter={(e) => {
              if (excerptInteractive)
                e.currentTarget.style.borderColor = "var(--accent-border)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "transparent";
            }}
          >
            <FileText
              size={10}
              style={{ flexShrink: 0, marginTop: 2, color: "var(--ink-40)" }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
              }}
            >
              {excerpt}
            </span>
          </button>
        </div>
      )}
      {onChat && !isRoot && (
        <div
          className="cnode__footer-bar"
          style={{ justifyContent: "flex-end" }}
        >
          <button
            className="btn btn-sm btn-ghost nodrag"
            onClick={onChat}
            title="Open a chat bubble seeded with this branch's context"
            style={{ color: "var(--purple)" }}
          >
            <MessagesSquare size={12} />
            Chat
          </button>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

export const ConceptNode = memo(ConceptNodeInner);
