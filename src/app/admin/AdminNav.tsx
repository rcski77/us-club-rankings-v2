"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

type NavItem = { href: string; label: string; superAdminOnly?: boolean };
type NavSection = { title: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    title: "Events",
    items: [
      { href: "/admin/events", label: "Events" },
      { href: "/admin/imports", label: "Imports" },
      { href: "/admin/division-genders", label: "Division Genders" },
    ],
  },
  {
    title: "Rankings",
    items: [
      { href: "/admin/team-rankings", label: "Team Rankings" },
      { href: "/admin/club-rankings", label: "Club Rankings" },
      { href: "/admin/analysis", label: "Analysis" },
      { href: "/admin/exports", label: "Exports" },
    ],
  },
  {
    title: "Directory",
    items: [
      { href: "/admin/teams", label: "Teams" },
      { href: "/admin/clubs", label: "Clubs" },
      { href: "/admin/club-groups", label: "Club Groups" },
      { href: "/admin/regions", label: "Regions" },
      { href: "/admin/seasons", label: "Seasons" },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/admin/point-templates", label: "Point Templates" },
      { href: "/admin/job-runs", label: "Job Runs" },
      { href: "/admin/users", label: "Users", superAdminOnly: true },
    ],
  },
];

// Which sections the viewer has expanded -- a per-browser convenience only, so every
// read/write is guarded (storage can be unavailable or throw, e.g. private windows).
const STORAGE_KEY = "admin-nav-open-sections";

const CHANGE_EVENT = "admin-nav-open-sections-change";

// The raw stored string is the snapshot (a stable primitive, as useSyncExternalStore
// requires); the server snapshot is always "[]", so the first render matches on both
// sides and the stored selection applies right after hydration.
function readStoredRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseOpen(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeStoredOpen(open: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
  } catch {
    // Not persisting is fine -- the section holding the current page still opens.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function isActive(pathname: string | null, href: string) {
  return pathname === href || !!pathname?.startsWith(`${href}/`);
}

const linkClass = "rounded px-2 py-1 hover:bg-slate-200";
const activeLinkClass = "rounded bg-slate-200 px-2 py-1 font-medium text-slate-900";

/**
 * The admin sidebar: Dashboard, then collapsible sections. The section holding the
 * current page is always open (and that page highlighted); others open/close on click,
 * independently, remembered per browser. A client component only because the active
 * route and the toggle state both need the browser -- see NavLink.tsx for the same
 * reason on the public header.
 */
export function AdminNav({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname();
  const openSections = parseOpen(useSyncExternalStore(subscribe, readStoredRaw, () => "[]"));

  function toggle(title: string, isOpen: boolean) {
    writeStoredOpen(isOpen ? openSections.filter((t) => t !== title) : [...openSections, title]);
  }

  return (
    <nav className="flex flex-col gap-1 text-sm">
      <Link href="/admin" className={pathname === "/admin" ? activeLinkClass : linkClass}>
        Dashboard
      </Link>
      {SECTIONS.map((section) => {
        const items = section.items.filter((item) => !item.superAdminOnly || isSuperAdmin);
        const containsActive = items.some((item) => isActive(pathname, item.href));
        const isOpen = containsActive || openSections.includes(section.title);
        return (
          <div key={section.title} className="mt-2">
            <button
              type="button"
              onClick={() => toggle(section.title, isOpen)}
              disabled={containsActive}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-200 disabled:cursor-default disabled:hover:bg-transparent"
            >
              {section.title}
              <span aria-hidden className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>
                ›
              </span>
            </button>
            {isOpen && (
              <div className="mt-1 flex flex-col gap-1 pl-2">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={isActive(pathname, item.href) ? activeLinkClass : linkClass}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
