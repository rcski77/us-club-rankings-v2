import Link from "next/link";
import { LogoHorizontal } from "@/components/Logo";
import { NavLink } from "@/components/NavLink";
import { brand } from "@/lib/brand";

export function PublicHeader() {
  return (
    <header style={{ backgroundColor: brand.purple }}>
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="shrink-0">
          <LogoHorizontal variant="onDark" />
        </Link>
        <nav className="flex gap-6">
          <NavLink href="/rankings/events">Events</NavLink>
          <NavLink href="/rankings/team-rankings">Rankings</NavLink>
        </nav>
      </div>
    </header>
  );
}
