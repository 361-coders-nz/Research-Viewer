// Markdown → DocRecord parser. Runs both in-browser (via web worker) and
// at build time (scripts/build-course.ts). Keep it dependency-free except
// for gray-matter so it works in both environments.

import matter from "gray-matter";
import type { JsonObject } from "@liveblocks/client";
import type { DocRecord, Heading } from "./liveblocks";

export type ParsedDoc = Omit<DocRecord, "importedBy" | "importedAt">;

const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g;
const REL_LINK_RE = /\[([^\]]+)\]\(\.\.?\/[^)]+?\.md[^)]*\)/g;
const BR_RE = /\bBR-[0-9]{2,4}[a-z]?\b/g;
const H2_RE = /^##\s+(.+?)\s*$/gm;
const H3_RE = /^###\s+(.+?)\s*$/gm;

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function parseMarkdown(filename: string, raw: string): ParsedDoc {
  const baseSlug = slugify(filename.replace(/\.md$/, ""));
  const parsed = matter(raw);
  const fm = jsonify(parsed.data ?? {}) as JsonObject;
  const body = parsed.content ?? "";

  // Title: frontmatter wins, else first H1, else filename
  let title = (fm.title as string | undefined) ?? "";
  if (!title) {
    const h1 = body.match(/^#\s+(.+?)\s*$/m);
    if (h1) title = h1[1].trim();
  }
  if (!title) title = filename.replace(/\.md$/, "");

  // Outbound links — collect wikilinks and relative .md links
  const outboundLinks = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) outboundLinks.add(m[1].trim());
  for (const m of body.matchAll(REL_LINK_RE)) {
    const url = m[0].match(/\(([^)]+)\)/)?.[1];
    if (url) {
      const stub = url.replace(/#.*$/, "").replace(/.*\//, "").replace(/\.md$/, "");
      if (stub) outboundLinks.add(stub);
    }
  }

  // BR refs
  const brRefs = Array.from(new Set(body.match(BR_RE) ?? []));

  // Headings
  const headings: Heading[] = [];
  for (const m of body.matchAll(H2_RE)) {
    const text = m[1].trim();
    headings.push({ level: 2, text, anchor: slugify(text) });
  }
  for (const m of body.matchAll(H3_RE)) {
    const text = m[1].trim();
    headings.push({ level: 3, text, anchor: slugify(text) });
  }
  // Preserve source order — re-sort by index of occurrence in body
  headings.sort((a, b) => body.indexOf(a.text) - body.indexOf(b.text));

  return {
    slug: baseSlug,
    title: String(title),
    frontmatter: fm,
    body,
    outboundLinks: Array.from(outboundLinks),
    brRefs,
    headings,
    bytes: body.length,
  };
}

export function uniqueSlug(
  candidate: string,
  existing: Set<string>,
): string {
  if (!existing.has(candidate)) return candidate;
  let i = 2;
  while (existing.has(`${candidate}-${i}`)) i++;
  return `${candidate}-${i}`;
}

// Coerce arbitrary JS values (e.g. Dates from gray-matter) into JSON-safe shapes.
function jsonify(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => jsonify(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonify(v);
    }
    return out;
  }
  return String(value);
}
