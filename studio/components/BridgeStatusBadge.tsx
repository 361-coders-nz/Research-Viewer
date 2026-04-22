"use client";

import { useEffect, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { getBridge, type BridgeStatus } from "@/lib/bridge";

const LABEL: Record<BridgeStatus, string> = {
  idle: "Bridge idle",
  connecting: "Bridge connecting…",
  connected: "Bridge online",
  error: "Bridge offline",
};

export function BridgeStatusBadge() {
  const [status, setStatus] = useState<BridgeStatus>("idle");

  useEffect(() => {
    const bridge = getBridge();
    bridge.connect();
    const off = bridge.onStatus(setStatus);
    return () => {
      off();
      // don't disconnect on unmount — TopBar is always mounted
    };
  }, []);

  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button type="button" className={`bridge-status ${status}`}>
            <span className="bridge-status__dot" />
            {LABEL[status]}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="bottom" sideOffset={6} className="panel-raised"
            style={{
              padding: "0.6rem 0.8rem",
              fontSize: "0.78rem",
              maxWidth: 260,
              color: "var(--ink-80)",
              lineHeight: 1.55,
            }}>
            {status === "connected"
              ? "Claude is running locally and will respond in canvas chat bubbles."
              : "Run `npm start` in studio-bridge/ to enable chat bubbles. Bridge runs locally; no cloud key needed."}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
