"use client";

import Link from "next/link";
import { nanoid } from "nanoid";
import { LiveObject } from "@liveblocks/client";
import {
  LayoutDashboard,
  FileText,
  Plus,
  MessagesSquare,
} from "lucide-react";
import { DropZoneButton } from "@/components/GlobalDropZone";
import {
  useWorkspaceMutation,
} from "@/lib/liveblocks";
import type { CanvasMeta } from "@/lib/liveblocks";
import { useCanvasList, useDocs } from "@/components/useDocs";
import { useStudioUser } from "@/components/RoomProviders";
import { useRouter } from "next/navigation";

const TILES = [
  {
    href: "/canvas",
    title: "Canvases",
    desc: "Freeform workspace. Drop markdown to generate a tree, chat with Claude, query branches.",
    Icon: LayoutDashboard,
  },
  {
    href: "/reader",
    title: "Reader",
    desc: "Read imported docs with TOC, wikilinks, and business-rule deep-links.",
    Icon: FileText,
  },
];

export default function HubPage() {
  const docs = useDocs();
  const canvases = useCanvasList();
  const { user } = useStudioUser();
  const router = useRouter();

  const createCanvas = useWorkspaceMutation(({ storage }) => {
    const id = nanoid(10);
    const meta: CanvasMeta = {
      id,
      title: "Untitled canvas",
      workspaceId:
        process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE ?? "oxflow-team",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    storage.get("canvases").set(id, new LiveObject(meta));
    setTimeout(() => router.push(`/canvas/${id}`), 50);
  }, [router]);

  return (
    <main className="hub">
      <header className="hub__header">
        <div className="eyebrow">welcome back, {user.name}</div>
        <h1 className="hub__title">
          A workspace for the oxFlow research corpus.
        </h1>
        <p className="hub__sub">
          Drag markdown files anywhere on the page to import them. Open a
          canvas to generate concept trees from docs or pasted text, and query
          individual branches with Claude — all sharable with your team.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem" }}>
          <DropZoneButton />
          <button className="btn btn-accent" onClick={() => createCanvas()}>
            <Plus size={14} />
            New canvas
          </button>
        </div>
      </header>

      <section className="hub__tiles">
        {TILES.map(({ href, title, desc, Icon }) => (
          <Link key={href} href={href} className="tile">
            <div className="tile__icon">
              <Icon size={18} />
            </div>
            <div className="tile__title">{title}</div>
            <div className="tile__desc">{desc}</div>
          </Link>
        ))}
      </section>

      <section className="hub__section">
        <div className="hub__row">
          <div className="hub__section-title">Your docs</div>
          <span className="mono" style={{ fontSize: "0.78rem", color: "var(--ink-40)" }}>
            {docs.length} imported
          </span>
        </div>
        {docs.length === 0 ? (
          <div className="empty-drop">
            <div className="empty-drop__title">No docs yet</div>
            <div style={{ fontSize: "0.88rem" }}>
              Drop .md files anywhere on the page, or use the Import button above.
            </div>
          </div>
        ) : (
          <div className="card-list">
            {docs.slice(0, 9).map((d) => (
              <Link
                key={d.slug}
                href={`/reader/${d.slug}`}
                className="canvas-card"
              >
                <div className="canvas-card__title">{d.title}</div>
                <div className="canvas-card__meta">
                  {(d.frontmatter.type as string | undefined) ?? "doc"} ·{" "}
                  {(d.bytes / 1024).toFixed(1)} KB
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="hub__section">
        <div className="hub__row">
          <div className="hub__section-title">Your canvases</div>
          <span className="mono" style={{ fontSize: "0.78rem", color: "var(--ink-40)" }}>
            {canvases.length}
          </span>
        </div>
        {canvases.length === 0 ? (
          <div className="empty-drop">
            <div className="empty-drop__title">No canvases yet</div>
            <div style={{ fontSize: "0.88rem", marginBottom: "1rem" }}>
              Create a canvas to drag docs in and start a Claude conversation.
            </div>
            <button className="btn btn-accent" onClick={() => createCanvas()}>
              <Plus size={14} /> New canvas
            </button>
          </div>
        ) : (
          <div className="card-list">
            {canvases.map((c) => (
              <Link key={c.id} href={`/canvas/${c.id}`} className="canvas-card">
                <div className="canvas-card__title">
                  <MessagesSquare
                    size={14}
                    style={{
                      display: "inline-block",
                      marginRight: 6,
                      verticalAlign: -2,
                      color: "var(--ink-40)",
                    }}
                  />
                  {c.title}
                </div>
                <div className="canvas-card__meta">
                  updated {new Date(c.updatedAt).toLocaleString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
