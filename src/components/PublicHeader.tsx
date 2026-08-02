import Link from "next/link";
import { LogoHorizontal } from "@/components/Logo";
import { NavLink } from "@/components/NavLink";
import { MobileNav } from "@/components/MobileNav";
import { brand } from "@/lib/brand";

export function PublicHeader() {
  return (
    <header className="relative" style={{ backgroundColor: brand.purple }}>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-x-4 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="shrink-0">
          <LogoHorizontal variant="onDark" width={240} className="h-auto w-[150px] sm:w-[240px]" />
        </Link>
        <nav className="hidden items-center gap-6 sm:flex">
          <NavLink href="/rankings/events">Events</NavLink>
          <NavLink href="/rankings/club-rankings">Clubs</NavLink>
          <NavLink href="/rankings/team-rankings">Rankings</NavLink>
        </nav>
        <MobileNav />
      </div>
    </header>
  );
}
