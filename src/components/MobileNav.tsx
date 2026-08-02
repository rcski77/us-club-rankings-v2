"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { brand } from "@/lib/brand";

const LINKS = [
  { href: "/rankings/events", label: "Events" },
  { href: "/rankings/club-rankings", label: "Clubs" },
  { href: "/rankings/team-rankings", label: "Rankings" },
];

/** Hamburger nav for the public header, shown only below `sm`. Kept as a separate
 * client component (rather than making PublicHeader itself client) so the header stays
 * server-rendered and this open/close state doesn't force the whole nav to hydrate. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex h-9 w-9 items-center justify-center rounded border border-white/30 text-white"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          {open ? (
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          ) : (
            <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
          )}
        </svg>
      </button>
      {open && (
        <div
          className="absolute inset-x-0 top-full border-t border-white/10 px-4 py-3 shadow-md"
          style={{ backgroundColor: brand.purple }}
        >
          <nav className="flex flex-col gap-1">
            {LINKS.map((l) => {
              const isActive = pathname === l.href || pathname?.startsWith(`${l.href}/`);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={
                    isActive
                      ? "rounded px-2 py-2 text-sm font-semibold text-white"
                      : "rounded px-2 py-2 text-sm text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                  }
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
