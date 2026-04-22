"use client";

import * as Popover from "@radix-ui/react-popover";
import { User } from "lucide-react";
import { useStudioUser } from "./RoomProviders";
import { useState } from "react";

export function UserMenu() {
  const { user, setName } = useStudioUser();
  const [draft, setDraft] = useState(user.name);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="btn btn-icon"
          title="Your identity"
          aria-label="Your identity"
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                background: user.color,
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: "0.8rem" }}>{user.name}</span>
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          className="panel-raised"
          style={{ padding: "0.9rem", width: 260 }}
        >
          <div style={{ fontSize: "0.72rem", color: "var(--ink-40)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
            Display name
          </div>
          <input
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setName(draft.trim() || user.name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setName(draft.trim() || user.name);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <div style={{ fontSize: "0.72rem", color: "var(--ink-40)", marginTop: 12 }}>
            Your ID is stored locally. Share the same workspace URL with the team
            — everyone sees the same imported docs and canvases.
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
