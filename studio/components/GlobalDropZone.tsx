"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FileText, Upload } from "lucide-react";
import { useImport } from "./useImport";

export function GlobalDropZone() {
  const [over, setOver] = useState(false);
  const counterRef = useRef(0);
  const { importFiles } = useImport();

  const hasFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      counterRef.current += 1;
      if (counterRef.current === 1) setOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      counterRef.current = Math.max(0, counterRef.current - 1);
      if (counterRef.current === 0) setOver(false);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const hasF = hasFiles(e);
      if (!hasF) return;
      // Skip drops inside the canvas surface — the canvas handles its own
      // md drops (generates a tree) instead of importing into the workspace.
      const target = e.target as HTMLElement | null;
      if (target?.closest(".canvas-surface")) {
        counterRef.current = 0;
        setOver(false);
        return;
      }
      e.preventDefault();
      counterRef.current = 0;
      setOver(false);
      await collectAndImport(e.dataTransfer, importFiles);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [importFiles]);

  return (
    <AnimatePresence>
      {over && (
        <motion.div
          className="dropzone-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <div className="dropzone-overlay__inner">
            <Upload size={18} />
            Drop .md files to add them to the workspace
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Recursive DataTransferItem collection — supports folders via webkitGetAsEntry
// ---------------------------------------------------------------------------

async function collectAndImport(
  dt: DataTransfer,
  importFiles: (files: File[]) => Promise<void> | void,
) {
  const files: File[] = [];
  const entries: FileSystemEntry[] = [];

  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item.kind !== "file") continue;
    const entry =
      "webkitGetAsEntry" in item
        ? (item as DataTransferItem).webkitGetAsEntry?.()
        : null;
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }

  for (const entry of entries) {
    await walkEntry(entry, files);
  }

  if (files.length === 0 && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i++) files.push(dt.files[i]);
  }

  await importFiles(files);
}

function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file((f) => {
        out.push(f);
        resolve();
      });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readBatch = () => {
        reader.readEntries(async (batch) => {
          if (batch.length === 0) {
            resolve();
            return;
          }
          for (const child of batch) await walkEntry(child, out);
          readBatch();
        });
      };
      readBatch();
    } else {
      resolve();
    }
  });
}

export function DropZoneButton() {
  const { importFiles } = useImport();
  const inputRef = useRef<HTMLInputElement>(null);
  const onChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      await importFiles(files);
      if (inputRef.current) inputRef.current.value = "";
    },
    [importFiles],
  );
  return (
    <>
      <button className="btn" onClick={() => inputRef.current?.click()}>
        <FileText size={14} />
        Import .md
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        multiple
        style={{ display: "none" }}
        onChange={onChange}
      />
    </>
  );
}
