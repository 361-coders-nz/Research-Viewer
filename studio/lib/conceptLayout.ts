import dagre from "dagre";
import type { GeneratedNodeJson } from "./liveblocks";

export type FlatConcept = {
  id: string;
  parentId: string | null;
  rootId: string;
  isRoot: boolean;
  label: string;
  summary: string;
  excerpt: string;
  sourceSlug: string;
};

export type XY = { x: number; y: number };

export function flattenTree(
  rootLabel: string,
  rootId: string,
  generatedNodes: GeneratedNodeJson[],
): FlatConcept[] {
  const out: FlatConcept[] = [];
  const rootNodeId = `c:${rootId}:root`;
  out.push({
    id: rootNodeId,
    parentId: null,
    rootId,
    isRoot: true,
    label: rootLabel || "Concept tree",
    summary: "",
    excerpt: "",
    sourceSlug: "",
  });
  const walk = (parentId: string, nodes: GeneratedNodeJson[]) => {
    for (const n of nodes) {
      const childId = `c:${rootId}:${n.id}`;
      out.push({
        id: childId,
        parentId,
        rootId,
        isRoot: false,
        label: n.label,
        summary: n.summary,
        excerpt: n.excerpt,
        sourceSlug: n.sourceSlug,
      });
      if (n.children && n.children.length > 0) walk(childId, n.children);
    }
  };
  walk(rootNodeId, generatedNodes);
  return out;
}

export function layoutFlat(
  flat: FlatConcept[],
  origin: XY,
): Map<string, XY> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 30,
    ranksep: 90,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of flat) {
    const width = 280;
    const height = n.isRoot ? 70 : n.excerpt ? 170 : 110;
    g.setNode(n.id, { width, height });
  }
  for (const n of flat) {
    if (n.parentId) g.setEdge(n.parentId, n.id);
  }
  dagre.layout(g);
  const positions = new Map<string, XY>();
  for (const n of flat) {
    const pos = g.node(n.id);
    if (!pos) continue;
    positions.set(n.id, {
      x: origin.x + (pos.x - pos.width / 2),
      y: origin.y + (pos.y - pos.height / 2),
    });
  }
  return positions;
}
