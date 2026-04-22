"use client";

import { useCallback } from "react";
import { LiveObject } from "@liveblocks/client";
import { parseMarkdown, uniqueSlug } from "@/lib/parse";
import {
  useWorkspaceMutation,
  useWorkspaceStorage,
} from "@/lib/liveblocks";
import { toast } from "@/lib/toast";
import { useStudioUser } from "./RoomProviders";

export function useImport() {
  const { user } = useStudioUser();
  const docs = useWorkspaceStorage((root) => root.docs);

  type ImportResult = {
    inserted: Array<{ slug: string; title: string; body: string }>;
    skipped: number;
    ignored: number;
    storageMissing?: boolean;
  };

  const importFilesInner = useWorkspaceMutation(
    async (
      { storage },
      rawFiles: File[],
    ): Promise<ImportResult> => {
      const files = rawFiles.filter((f) =>
        f.name.toLowerCase().endsWith(".md"),
      );
      const ignored = rawFiles.length - files.length;
      const inserted: ImportResult["inserted"] = [];

      if (files.length === 0) {
        return { inserted, skipped: 0, ignored };
      }

      const docMap = storage.get("docs");
      if (!docMap) {
        console.error("[import] workspace docs map missing from storage");
        return { inserted, skipped: files.length, ignored, storageMissing: true };
      }

      const existingSlugs = new Set<string>();
      for (const [slug] of docMap.entries()) existingSlugs.add(slug);

      const failures: Array<{ name: string; error: string }> = [];
      for (const file of files) {
        try {
          const text = await file.text();
          const parsed = parseMarkdown(file.name, text);
          const slug = uniqueSlug(parsed.slug, existingSlugs);
          existingSlugs.add(slug);
          docMap.set(
            slug,
            new LiveObject({
              ...parsed,
              slug,
              importedBy: user.id,
              importedAt: Date.now(),
            }),
          );
          inserted.push({ slug, title: parsed.title, body: parsed.body });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          console.error("[import] failed:", file.name, err);
          failures.push({ name: file.name, error: message });
        }
      }

      console.info(
        `[import] parsed=${inserted.length} failed=${failures.length} ignored=${ignored} totalDocsAfter=${docMap.size}`,
      );

      // Stash failure details so the outer callback can toast per-file.
      // Using an augmented return type here rather than a new type to keep
      // the mutation inline.
      const augmented = {
        inserted,
        skipped: failures.length,
        ignored,
        failures,
      };
      return augmented as unknown as ImportResult;
    },
    [user.id],
  );

  const importFiles = useCallback(
    async (rawFiles: File[]) => {
      const result = (await importFilesInner(rawFiles)) as ImportResult & {
        failures?: Array<{ name: string; error: string }>;
      };
      const { inserted, skipped, ignored, storageMissing, failures } = result;

      if (storageMissing) {
        toast(
          "Workspace not ready — refresh the page and try again.",
          "error",
        );
        return;
      }

      if (failures && failures.length > 0) {
        for (const f of failures) {
          toast(
            `Failed to import ${f.name}: ${f.error.slice(0, 80)}`,
            "error",
          );
        }
      }

      if (inserted.length === 0) {
        if (ignored > 0 && skipped === 0) {
          toast(
            `Only .md files are supported — ignored ${ignored} file(s)`,
            "error",
          );
        } else if (skipped > 0 && !failures) {
          toast(`Failed to import ${skipped} file(s)`, "error");
        }
        return;
      }

      toast(
        `Imported ${inserted.length} doc${inserted.length === 1 ? "" : "s"}${
          ignored > 0 ? ` (ignored ${ignored} non-md)` : ""
        }${skipped > 0 ? ` — ${skipped} failed` : ""}`,
        "success",
      );
    },
    [importFilesInner],
  );

  const removeDoc = useWorkspaceMutation(({ storage }, slug: string) => {
    storage.get("docs").delete(slug);
  }, []);

  return {
    docs,
    importFiles,
    removeDoc,
  };
}
