"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import type { DocRecord } from "@/lib/liveblocks";
import { slugify } from "@/lib/parse";

// Pre-process the markdown body to rewrite:
//   [[slug]] or [[slug|label]] → [label](/reader/slug)
//   BR-XXX → [BR-XXX](/reader/business-rules#br-xxx){.br-link}  (kept inline)
function preprocess(body: string): string {
  return body
    .replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_m, slug, anchor, label) => {
      const s = (slug as string).trim();
      const a = anchor ? `#${slugify(anchor as string)}` : "";
      const l = label ? (label as string).trim() : s;
      return `[${l}](/reader/${s}${a} "${s}")`;
    })
    .replace(/(^|\W)(BR-\d{2,4}[a-z]?)\b/g, (m, pre, br) => {
      return `${pre}[\`${br}\`](/reader/business-rules#${br.toLowerCase()})`;
    });
}

type Props = {
  doc: DocRecord;
  highlightQuote?: string; // a verbatim substring to highlight (course "See source")
};

function MarkdownReaderInner({ doc, highlightQuote }: Props) {
  const body = useMemo(() => preprocess(doc.body ?? ""), [doc.body]);
  const rootRef = useRef<HTMLDivElement>(null);

  // After render, scan the DOM for the verbatim quote and wrap occurrences
  // in <mark class="highlight-quote">. Done client-side so table/paragraph
  // structure in the markdown stays untouched.
  useEffect(() => {
    if (!highlightQuote || !rootRef.current) return;
    const needle = highlightQuote.trim();
    if (!needle) return;

    const root = rootRef.current;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.nodeValue && n.nodeValue.includes(needle)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });

    const matches: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      matches.push(current as Text);
      current = walker.nextNode();
    }

    for (const textNode of matches) {
      const value = textNode.nodeValue ?? "";
      const idx = value.indexOf(needle);
      if (idx === -1) continue;
      const before = document.createTextNode(value.slice(0, idx));
      const after = document.createTextNode(value.slice(idx + needle.length));
      const mark = document.createElement("mark");
      mark.className = "highlight-quote";
      mark.textContent = needle;
      const parent = textNode.parentNode;
      if (!parent) continue;
      parent.insertBefore(before, textNode);
      parent.insertBefore(mark, textNode);
      parent.insertBefore(after, textNode);
      parent.removeChild(textNode);
      // scroll first match into view
      if (textNode === matches[0]) {
        requestAnimationFrame(() => {
          mark.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    }

    return () => {
      // Clean up marks we added so re-renders don't compound
      const existing = root.querySelectorAll("mark.highlight-quote");
      for (const el of Array.from(existing)) {
        const text = document.createTextNode(el.textContent ?? "");
        el.parentNode?.replaceChild(text, el);
      }
    };
  }, [highlightQuote, body]);

  return (
    <div className="md-body" ref={rootRef}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: "wrap", properties: { class: "heading-anchor" } }],
        ]}
        components={{
          a: ({ href, children, ...rest }) => {
            if (!href) return <span>{children}</span>;
            if (href.startsWith("/reader/") || href.startsWith("/course/")) {
              return (
                <Link href={href} {...(rest as Record<string, unknown>)}>
                  {children}
                </Link>
              );
            }
            return (
              <a
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noreferrer" : undefined}
                {...(rest as Record<string, unknown>)}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownReader = memo(MarkdownReaderInner);

export function Toc({ doc }: { doc: DocRecord }) {
  if (doc.headings.length === 0) return null;
  return (
    <aside className="reader-toc">
      <h4>On this page</h4>
      <ul>
        {doc.headings.map((h) => (
          <li key={h.anchor} className={h.level === 3 ? "h3" : undefined}>
            <a href={`#${h.anchor}`}>{h.text}</a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
