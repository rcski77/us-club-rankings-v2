"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Bolds/whitens the label when the current route matches (or is nested under) href
 * -- plain <Link>s can't do this since knowing the active route needs client-side
 * pathname, unlike everything else on these pages which stays server-rendered. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname?.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={
        isActive
          ? "text-sm font-semibold text-white"
          : "text-sm text-white/75 transition-colors hover:text-white"
      }
    >
      {children}
    </Link>
  );
}
