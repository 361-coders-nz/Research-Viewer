// ============================================================================
// Locked prompt for the concept-tree generator.
// Any change here should be deliberate — drift rots the validation layer.
// ============================================================================

export const TREE_SYSTEM_PROMPT = `You build concept trees from source markdown.

Produce STRICT JSON matching this TypeScript type and NOTHING else:

  type Tree = {
    rootLabel: string;
    nodes: Node[];
  };
  type Node = {
    label: string;       // 2-6 words, no trailing punctuation
    summary: string;     // 1 sentence, <= 25 words
    excerpt: string;     // a verbatim passage (10-200 chars) copied from one source
    sourceSlug: string;  // which <source slug="..."> the excerpt was copied from
    children?: Node[];
  };

Rules:
- Group by concept, not by document structure. Cross-cut across sources when they speak to the same idea.
- Tree depth: 2 to 4 levels.
- Width: 3 to 7 top-level nodes; 2 to 6 children per inner node where useful.
- Every excerpt MUST appear verbatim in exactly one source (case-sensitive, whitespace-normal). If you cannot find one, skip that node rather than paraphrase.
- Keep summaries concrete and plain. No filler ("This section discusses..." is forbidden).
- Output JSON only. No code fences. No commentary.`;

export type TreePromptInput = {
  sources: Array<{ slug: string; title: string; body: string }>;
  focusPrompt: string | null;
};

export function buildTreePrompt(input: TreePromptInput): string {
  const sourceBlocks = input.sources
    .map(
      (s) =>
        `<source slug="${escapeAttr(s.slug)}" title="${escapeAttr(s.title)}">\n${s.body}\n</source>`,
    )
    .join("\n\n");

  const focus =
    input.focusPrompt && input.focusPrompt.trim().length > 0
      ? input.focusPrompt.trim()
      : "(none — produce the best general breakdown)";

  return [
    TREE_SYSTEM_PROMPT,
    "",
    sourceBlocks,
    "",
    `FOCUS: ${focus}`,
    "",
    "Return JSON now.",
  ].join("\n");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '\\"');
}
