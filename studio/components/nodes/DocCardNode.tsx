"use client";

import { memo } from "react";
import Link from "next/link";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FileText, ExternalLink } from "lucide-react";
import { useDoc } from "../useDocs";
import { NodeDeleteButton } from "./NodeChrome";

type Data = {
  slug: string;
};

function DocCardNodeInner({ id, data, selected }: NodeProps) {
  const { slug } = data as Data;
  const doc = useDoc(slug);

  if (!doc) {
    return (
      <div className={`cnode cnode--doc ${selected ? "selected" : ""}`}>
        <NodeDeleteButton id={id} />
        <div className="cnode__head">
          <FileText size={13} style={{ color: "var(--ink-40)" }} />
          <div className="cnode__title">Missing: {slug}</div>
        </div>
        <div className="cnode__body" style={{ color: "var(--ink-40)" }}>
          This doc is no longer in the workspace. Re-import to restore.
        </div>
        <Handle type="source" position={Position.Right} />
        <Handle type="target" position={Position.Left} />
      </div>
    );
  }

  const preview = firstParagraph(doc.body, 380);

  return (
    <div className={`cnode cnode--doc ${selected ? "selected" : ""}`}>
      <NodeDeleteButton id={id} />
      <div className="cnode__head">
        <FileText size={13} style={{ color: "var(--accent)" }} />
        <div className="cnode__title">{doc.title}</div>
      </div>
      <div className="cnode__body">{preview}</div>
      <div className="cnode__footer-bar">
        <span className="mono" style={{ fontSize: "0.7rem", color: "var(--ink-40)" }}>
          {(doc.bytes / 1024).toFixed(1)} KB · {doc.headings.length} sections
        </span>
        <span className="spacer" />
        <Link
          href={`/reader/${doc.slug}`}
          className="btn btn-sm btn-ghost nodrag"
          onClick={(e) => e.stopPropagation()}
          title="Open in reader"
        >
          <ExternalLink size={12} />
          Read
        </Link>
      </div>
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

function firstParagraph(body: string, max = 320): string {
  if (!body) return "";
  const stripped = body
    .replace(/^---[\s\S]*?---\n?/m, "")
    .replace(/^#+\s+.*/gm, "")
    .replace(/^>.*/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
  const para = stripped.split(/\n{2,}/).find((p) => p.trim().length > 0) ?? "";
  const flat = para.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1).trimEnd() + "…";
}

export const DocCardNode = memo(DocCardNodeInner);
