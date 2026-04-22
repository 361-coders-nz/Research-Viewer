"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MarkdownReader, Toc } from "@/components/MarkdownReader";
import { useDoc } from "@/components/useDocs";

export default function ReaderPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = use(params);
  const target = slug.join("/");
  const doc = useDoc(target);
  const searchParams = useSearchParams();
  const highlight = searchParams.get("q") ?? undefined;

  // After render, scroll to anchor if present
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash?.slice(1);
    if (hash) {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [doc]);

  if (!doc) {
    return (
      <main className="hub">
        <div className="empty-drop">
          <div className="empty-drop__title">Doc not found</div>
          <div style={{ fontSize: "0.88rem", marginBottom: "1rem" }}>
            &ldquo;{target}&rdquo; isn&apos;t in the workspace. Import it (drop the .md)
            or pick another doc from the reader index.
          </div>
          <Link href="/reader" className="btn btn-accent">
            Browse docs
          </Link>
        </div>
      </main>
    );
  }

  const meta = doc.frontmatter as unknown as {
    author?: string;
    date?: string;
    type?: string;
    tags?: string[];
  };

  return (
    <main className="reader-page">
      <Toc doc={doc} />
      <article className="reader-body">
        <div className="eyebrow">
          {(meta.type as string | undefined) ?? "doc"}
        </div>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 300,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
            margin: "0.35rem 0 0.9rem",
          }}
        >
          {doc.title}
        </h1>
        <div className="reader-meta">
          {meta.author ? <span>{meta.author}</span> : null}
          {meta.date ? <span>{meta.date}</span> : null}
          {meta.tags?.map((t) => (
            <span key={t} className="reader-meta__tag">
              {t}
            </span>
          ))}
        </div>
        <MarkdownReader doc={doc} highlightQuote={highlight ?? undefined} />
      </article>
    </main>
  );
}
