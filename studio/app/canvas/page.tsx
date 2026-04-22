"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { LiveObject } from "@liveblocks/client";
import { Plus } from "lucide-react";
import {
  useWorkspaceMutation,
} from "@/lib/liveblocks";
import type { CanvasMeta } from "@/lib/liveblocks";
import { useCanvasList } from "@/components/useDocs";

export default function CanvasListPage() {
  const list = useCanvasList();
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
        <div className="eyebrow">canvases</div>
        <h1 className="hub__title">Your collaborative canvases</h1>
        <p className="hub__sub">
          Each canvas is a shared multiplayer workspace. Drag docs in, write
          sticky notes, drop Claude chat bubbles. Everything syncs in real time.
        </p>
        <div style={{ marginTop: "1.25rem" }}>
          <button className="btn btn-accent" onClick={() => createCanvas()}>
            <Plus size={14} /> New canvas
          </button>
        </div>
      </header>

      {list.length === 0 ? (
        <div className="empty-drop">
          <div className="empty-drop__title">No canvases yet</div>
          <div style={{ fontSize: "0.88rem", marginBottom: "1rem" }}>
            Create one to start laying out docs, notes, and chat bubbles.
          </div>
          <button className="btn btn-accent" onClick={() => createCanvas()}>
            <Plus size={14} /> New canvas
          </button>
        </div>
      ) : (
        <div className="card-list">
          {list.map((c) => (
            <Link key={c.id} href={`/canvas/${c.id}`} className="canvas-card">
              <div className="canvas-card__title">{c.title}</div>
              <div className="canvas-card__meta">
                updated {new Date(c.updatedAt).toLocaleString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
