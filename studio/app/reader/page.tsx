"use client";

import Link from "next/link";
import { useDocs } from "@/components/useDocs";
import { DropZoneButton } from "@/components/GlobalDropZone";

export default function ReaderIndexPage() {
  const docs = useDocs();

  return (
    <main className="hub">
      <header className="hub__header">
        <div className="eyebrow">reader</div>
        <h1 className="hub__title">Read imported docs</h1>
        <p className="hub__sub">
          Markdown with TOC, resolved wikilinks, and business-rule deep-links.
          The list reflects what's currently in the workspace.
        </p>
        <div style={{ marginTop: "1.2rem" }}>
          <DropZoneButton />
        </div>
      </header>

      {docs.length === 0 ? (
        <div className="empty-drop">
          <div className="empty-drop__title">No docs yet</div>
          <div style={{ fontSize: "0.88rem" }}>
            Drag .md files anywhere to start reading.
          </div>
        </div>
      ) : (
        <div className="card-list">
          {docs.map((d) => (
            <Link key={d.slug} href={`/reader/${d.slug}`} className="canvas-card">
              <div className="canvas-card__title">{d.title}</div>
              <div className="canvas-card__meta">
                {(d.frontmatter.type as string | undefined) ?? "doc"} ·{" "}
                {d.headings.length} headings · {(d.bytes / 1024).toFixed(1)} KB
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
