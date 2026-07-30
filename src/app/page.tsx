import Link from "next/link";
import { PublicHeader } from "@/components/PublicHeader";
import { LogoStacked } from "@/components/Logo";
import { brand } from "@/lib/brand";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <LogoStacked width={200} />
        <p className="mt-6 mb-8 max-w-md text-slate-500">
          Team finishes, divisions, and rankings for youth volleyball club events.
        </p>
        <div className="flex gap-3">
          <Link
            href="/rankings/events"
            className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: brand.purple }}
          >
            View Rankings
          </Link>
          <Link
            href="/admin"
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100"
          >
            Staff Login
          </Link>
        </div>
      </main>
    </div>
  );
}
