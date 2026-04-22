"use client";

import { useMemo } from "react";
import { useWorkspaceStorage } from "@/lib/liveblocks";
import type { DocRecord } from "@/lib/liveblocks";

export function useDocs(): DocRecord[] {
  const docs = useWorkspaceStorage((root) => root.docs);
  return useMemo<DocRecord[]>(() => {
    if (typeof window !== "undefined") {
      console.debug("[docs] snapshot size:", docs?.size ?? "null");
    }
    if (!docs) return [];
    const out: DocRecord[] = [];
    for (const [, doc] of docs) out.push(doc as unknown as DocRecord);
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }, [docs]);
}

export function useDoc(slug: string | null | undefined): DocRecord | null {
  const docs = useDocs();
  return useMemo(
    () => (slug ? docs.find((d) => d.slug === slug) ?? null : null),
    [docs, slug],
  );
}

export function useCanvasList() {
  const canvases = useWorkspaceStorage((root) => root.canvases);
  return useMemo(() => {
    if (!canvases) return [];
    const out: Array<{
      id: string;
      title: string;
      createdAt: number;
      updatedAt: number;
    }> = [];
    for (const [, c] of canvases) {
      const rec = c as unknown as {
        id: string;
        title: string;
        createdAt: number;
        updatedAt: number;
      };
      out.push(rec);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [canvases]);
}
