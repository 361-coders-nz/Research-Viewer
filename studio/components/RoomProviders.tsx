"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ClientSideSuspense } from "@liveblocks/react";
import {
  WorkspaceRoomProvider,
  buildWorkspaceInitialStorage,
  defaultPresence,
  workspaceRoomId,
} from "@/lib/liveblocks";
import { getOrCreateUser, type StudioUser } from "@/lib/user";

const WORKSPACE_ID =
  process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE ?? "oxflow-team";

// ===========================================================================
// User context
// ===========================================================================

type UserCtx = {
  user: StudioUser;
  setName: (name: string) => void;
};

const UserContext = createContext<UserCtx | null>(null);

export function useStudioUser(): UserCtx {
  const ctx = useContext(UserContext);
  return (
    ctx ?? {
      user: { id: "anon", name: "anon", color: "#10B981" },
      setName: () => {},
    }
  );
}

// Server-stable initial identity so SSR doesn't wobble. Client hydrates real
// identity in a useEffect after mount.
const SSR_FALLBACK_USER: StudioUser = {
  id: "ssr",
  name: "Guest",
  color: "#10B981",
};

export function RoomProviders({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StudioUser>(SSR_FALLBACK_USER);

  useEffect(() => {
    setUser(getOrCreateUser());
  }, []);

  const ctxValue = useMemo<UserCtx>(
    () => ({
      user,
      setName: (name: string) => {
        const updated = { ...user, name: name || user.name };
        setUser(updated);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            "oxflow-studio:user",
            JSON.stringify(updated),
          );
        }
      },
    }),
    [user],
  );

  return (
    <UserContext.Provider value={ctxValue}>
      <WorkspaceRoomProvider
        id={workspaceRoomId(WORKSPACE_ID)}
        initialPresence={{
          ...defaultPresence,
          name: user.name,
          color: user.color,
        }}
        initialStorage={buildWorkspaceInitialStorage()}
      >
        <ClientSideSuspense fallback={<BootSplash />}>
          {children}
        </ClientSideSuspense>
      </WorkspaceRoomProvider>
    </UserContext.Provider>
  );
}

function BootSplash() {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink-40)",
        fontSize: "0.9rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: "var(--accent)",
            boxShadow: "0 0 0 4px var(--accent-bg)",
            animation: "pulse 1.2s infinite",
          }}
        />
        Connecting workspace…
      </div>
    </div>
  );
}
