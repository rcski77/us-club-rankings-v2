import Link from "next/link";
import { LogoHorizontal } from "@/components/Logo";
import { NavLink } from "@/components/NavLink";
import { brand } from "@/lib/brand";

export function PublicHeader() {
  return (
    <header style={{ backgroundColor: brand.purple }}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="shrink-0">
          <LogoHorizontal variant="onDark" width={240} />
        </Link>
        <nav className="flex items-center gap-6">
          <NavLink href="/rankings/events">Events</NavLink>
          <NavLink href="/rankings/club-rankings">Clubs</NavLink>
          <NavLink href="/rankings/team-rankings">Rankings</NavLink>
          <Link
            href="/admin"
            className="rounded border border-white/30 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            Staff Login
          </Link>
        </nav>
      </div>
    </header>
  );
}
