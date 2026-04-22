"use client";

import { use } from "react";
import { ClientSideSuspense } from "@liveblocks/react";
import {
  CanvasRoomProvider,
  buildCanvasInitialStorage,
  canvasRoomId,
  defaultPresence,
} from "@/lib/liveblocks";
import { Canvas } from "@/components/Canvas";
import { useStudioUser } from "@/components/RoomProviders";

export default function CanvasRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useStudioUser();
  const workspaceId =
    process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE ?? "oxflow-team";

  return (
    <CanvasRoomProvider
      id={canvasRoomId(id)}
      initialPresence={{
        ...defaultPresence,
        name: user.name,
        color: user.color,
      }}
      initialStorage={buildCanvasInitialStorage(id, workspaceId)}
    >
      <ClientSideSuspense
        fallback={
          <div
            style={{
              height: "calc(100vh - 56px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-40)",
              fontSize: "0.9rem",
            }}
          >
            Loading canvas…
          </div>
        }
      >
        <Canvas canvasId={id} />
      </ClientSideSuspense>
    </CanvasRoomProvider>
  );
}
