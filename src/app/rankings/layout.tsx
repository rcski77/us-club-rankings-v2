import { PublicHeader } from "@/components/PublicHeader";
import { LogoMark } from "@/components/Logo";

export default function PublicRankingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      </main>
      <footer className="border-t border-slate-200 px-6 py-6">
        <div className="mx-auto flex max-w-5xl items-center gap-2 text-xs text-slate-400">
          <LogoMark size={18} />
          US Club Rankings · Powered by Triple Crown Sports
        </div>
      </footer>
    </div>
  );
}
