import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 px-6 py-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <LogoMark size={18} />
          US Club Rankings · Powered by Triple Crown Sports
        </div>
        <Link href="/admin" className="transition-colors hover:text-slate-600">
          Staff Login
        </Link>
      </div>
    </footer>
  );
}
