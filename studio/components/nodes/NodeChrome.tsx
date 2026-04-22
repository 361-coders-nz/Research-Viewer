"use client";

import { X } from "lucide-react";
import { useCanvasMutation } from "@/lib/liveblocks";

export function NodeDeleteButton({ id }: { id: string }) {
  const removeNode = useCanvasMutation(({ storage }, nodeId: string) => {
    const nodes = storage.get("nodes");
    for (let i = 0; i < nodes.length; i++) {
      if (nodes.get(i)!.id === nodeId) {
        nodes.delete(i);
        return;
      }
    }
  }, []);

  return (
    <button
      className="cnode__delete nodrag"
      onClick={(e) => {
        e.stopPropagation();
        removeNode(id);
      }}
      title="Remove from canvas"
      aria-label="Remove from canvas"
    >
      <X size={12} />
    </button>
  );
}
