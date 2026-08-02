import Link from "next/link";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { LogoStacked } from "@/components/Logo";
import { brand } from "@/lib/brand";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getStats() {
  // Sequential, not Promise.all -- see docs/dev-environment.md.
  const eventCount = await prisma.event.count();
  const clubCount = await prisma.club.count();
  const teamCount = await prisma.team.count();
  const matchCount = await prisma.match.count();
  return { eventCount, clubCount, teamCount, matchCount };
}

export default async function Home() {
  const stats = await getStats();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <LogoStacked width={200} />
        <p className="mt-6 mb-8 max-w-md text-slate-500">
          Team finishes, divisions, and rankings for youth volleyball club events.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/rankings/events"
            className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: brand.purple }}
          >
            Events
          </Link>
          <Link
            href="/rankings/club-rankings"
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100"
          >
            Club Rankings
          </Link>
          <Link
            href="/rankings/team-rankings"
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100"
          >
            Team Rankings
          </Link>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-8 text-center">
          {[
            { label: "Events", value: stats.eventCount },
            { label: "Clubs", value: stats.clubCount, href: "/rankings/club-rankings" },
            { label: "Teams", value: stats.teamCount, href: "/rankings/team-rankings" },
            { label: "Matches", value: stats.matchCount },
          ].map((stat) => {
            const body = (
              <>
                <div className="text-2xl font-semibold" style={{ color: brand.purple }}>
                  {stat.value.toLocaleString()}
                </div>
                <div className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</div>
              </>
            );
            return stat.href ? (
              <Link key={stat.label} href={stat.href} className="transition-opacity hover:opacity-75">
                {body}
              </Link>
            ) : (
              <div key={stat.label}>{body}</div>
            );
          })}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
