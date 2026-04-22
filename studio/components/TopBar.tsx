"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BridgeStatusBadge } from "./BridgeStatusBadge";
import { UserMenu } from "./UserMenu";

const NAV = [
  { href: "/", label: "Hub" },
  { href: "/canvas", label: "Canvas" },
  { href: "/reader", label: "Reader" },
];

export function TopBar() {
  const path = usePathname() ?? "/";

  return (
    <header className="topbar">
      <Link href="/" className="topbar__brand">
        <span className="topbar__dot" />
        oxFlow Studio
      </Link>

      <nav className="topbar__nav">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={active ? "active" : undefined}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="topbar__right">
        <BridgeStatusBadge />
        <UserMenu />
      </div>
    </header>
  );
}
