import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";

export default function PublicRankingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-6 sm:py-8">
        <div className="sm:rounded-xl sm:border sm:border-slate-200 sm:bg-white sm:p-6 sm:shadow-sm">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}
