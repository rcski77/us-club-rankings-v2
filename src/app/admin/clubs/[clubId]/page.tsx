import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  inputClass,
  selectClass,
  primaryButtonClass,
  smallSecondaryButtonClass,
  errorBannerClass,
  successBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";
import { updateClub, leaveRankingGroup } from "./actions";
import { computeCombinedRankByTeam } from "@/lib/rating/powerRankings";

export default async function ClubDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { clubId } = await params;
  const { error, success } = await searchParams;

  // club, regions, and activeSeason don't depend on each other's results.
  const [club, regions, activeSeason] = await Promise.all([
    prisma.club.findUnique({
      where: { id: clubId },
      include: {
        region: true,
        contacts: true,
        mergedInto: true,
        mergedClubs: { include: { region: true }, orderBy: { name: "asc" } },
        rankingGroupPrimary: true,
        rankingGroupMembers: { include: { region: true }, orderBy: { name: "asc" } },
        teams: {
          include: { seasons: { include: { season: true }, orderBy: { season: { startDate: "desc" } } } },
          orderBy: { name: "asc" },
        },
      },
    }),
    prisma.region.findMany({ orderBy: { code: "asc" } }),
    prisma.season.findFirst({ where: { isActive: true } }),
  ]);
  if (!club) notFound();

  // National rank = the Combined Rankings blend (50% NPS rank + 50% Power Avg Rank),
  // same number shown on /admin/team-rankings' Combine tab -- computed per (season,
  // ageGroup), so only fetch it for the age groups this club actually fields a team
  // in this season, not all of AGE_GROUPS.
  const activeAgeGroups = activeSeason
    ? Array.from(
        new Set(
          club.teams.flatMap((t) =>
            t.seasons.filter((ts) => ts.seasonId === activeSeason.id).map((ts) => ts.ageGroup),
          ),
        ),
      )
    : [];
  const combinedRankMaps = activeSeason
    ? await Promise.all(
        activeAgeGroups.map((ageGroup) => computeCombinedRankByTeam(activeSeason.id, ageGroup)),
      )
    : [];
  const nationalRankByTeamId = new Map<string, number>();
  for (const map of combinedRankMaps) {
    for (const [teamId, rank] of map) nationalRankByTeamId.set(teamId, rank);
  }

  const updateClubWithId = updateClub.bind(null, clubId);
  const leaveRankingGroupWithId = leaveRankingGroup.bind(null, clubId);

  const sortedTeams = [...club.teams].sort((a, b) => {
    const aTs = activeSeason ? a.seasons.find((ts) => ts.seasonId === activeSeason.id) : undefined;
    const bTs = activeSeason ? b.seasons.find((ts) => ts.seasonId === activeSeason.id) : undefined;
    if (!aTs && !bTs) return a.name.localeCompare(b.name);
    if (!aTs) return 1;
    if (!bTs) return -1;
    if (aTs.ageGroup !== bTs.ageGroup) return aTs.ageGroup - bTs.ageGroup;
    return aTs.teamNumber.localeCompare(bTs.teamNumber, undefined, { numeric: true });
  });

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/clubs" className="underline">
          Clubs
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">{club.name}</h1>

      {error === "invalid" && <p className={errorBannerClass}>Club name is required.</p>}
      {success === "1" && <p className={successBannerClass}>Club saved.</p>}
      {success === "removed_from_group" && (
        <p className={successBannerClass}>
          Removed from the ranking group — this club will score on its own again next recompute.
        </p>
      )}

      {club.mergedInto && (
        <p className="mb-6 rounded bg-amber-50 p-3 text-sm text-amber-800">
          This club was merged into{" "}
          <Link href={`/admin/clubs/${club.mergedInto.id}`} prefetch={false} className="underline">
            {club.mergedInto.name}
          </Link>
          . It&apos;s kept for historical reference only — edit actions here are disabled. Manage
          merges from{" "}
          <Link href="/admin/club-groups" className="underline">
            Club Groups
          </Link>
          .
        </p>
      )}

      {club.rankingGroupPrimary && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded bg-blue-50 p-3 text-sm text-blue-800">
          <span>
            This club&apos;s results are combined with{" "}
            <Link href={`/admin/clubs/${club.rankingGroupPrimary.id}`} prefetch={false} className="underline">
              {club.rankingGroupPrimary.name}
            </Link>{" "}
            for club rankings — it stays fully active otherwise (own teams, own imports), it just
            won&apos;t get its own separate Club Rankings entry.
          </span>
          <form action={leaveRankingGroupWithId}>
            <button type="submit" className={smallSecondaryButtonClass}>
              Remove from ranking group
            </button>
          </form>
        </div>
      )}

      {!club.mergedInto && (
        <section className="mb-8 max-w-lg">
          <h2 className="mb-2 text-lg font-medium">Edit club</h2>
          <form action={updateClubWithId} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input name="name" defaultValue={club.name} required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Region
              <select name="regionId" className={selectClass} defaultValue={club.regionId ?? ""}>
                <option value="">(none)</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} — {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              External code
              <input
                name="externalCode"
                defaultValue={club.externalCode ?? ""}
                placeholder="frogs"
                className={`${inputClass} w-32`}
              />
            </label>
            <div className="flex gap-3">
              <label className="flex flex-col gap-1 text-sm">
                City
                <input name="city" defaultValue={club.city ?? ""} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                State
                <input
                  name="state"
                  defaultValue={club.state ?? ""}
                  maxLength={2}
                  className={`${inputClass} w-16`}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Zip
                <input name="zip" defaultValue={club.zip ?? ""} className={`${inputClass} w-24`} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input name="isActive" type="checkbox" defaultChecked={club.isActive} />
              Active
            </label>
            <button type="submit" className={`${primaryButtonClass} self-start`}>
              Save
            </button>
          </form>
        </section>
      )}

      {club.mergedClubs.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-medium">Clubs merged into this one</h2>
          <table className={`${tableClass} max-w-2xl`}>
            <thead>
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Region</th>
                <th className={thClass}>External code</th>
              </tr>
            </thead>
            <tbody>
              {club.mergedClubs.map((c) => (
                <tr key={c.id}>
                  <td className={tdClass}>
                    <Link href={`/admin/clubs/${c.id}`} prefetch={false} className="text-slate-900 underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className={tdClass}>{c.region?.code ?? ""}</td>
                  <td className={tdClass}>{c.externalCode ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {club.rankingGroupMembers.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-medium">Clubs combined with this one for rankings</h2>
          <table className={`${tableClass} max-w-2xl`}>
            <thead>
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Region</th>
                <th className={thClass}>External code</th>
              </tr>
            </thead>
            <tbody>
              {club.rankingGroupMembers.map((c) => (
                <tr key={c.id}>
                  <td className={tdClass}>
                    <Link href={`/admin/clubs/${c.id}`} prefetch={false} className="text-slate-900 underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className={tdClass}>{c.region?.code ?? ""}</td>
                  <td className={tdClass}>{c.externalCode ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!club.mergedInto && !club.rankingGroupPrimary && club.mergedClubs.length === 0 && (
        <p className="mb-8 text-sm text-slate-500">
          To merge another club into this one, or combine it with another club for rankings, use{" "}
          <Link href="/admin/club-groups" className="underline">
            Club Groups
          </Link>
          .
        </p>
      )}

      <h2 className="mb-2 text-lg font-medium">Teams</h2>
      {activeSeason && (
        <p className="mb-2 text-xs text-slate-500">
          Age, team #, and code shown are for the active season ({activeSeason.label}). National
          Rank is each team&apos;s Combined Rankings position (50% NPS rank + 50% Power Avg Rank)
          within its age group.
        </p>
      )}
      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Age</th>
            <th className={thClass}>Team #</th>
            <th className={thClass}>Team code</th>
            <th className={thClass}>National Rank</th>
            <th className={thClass}>Seasons</th>
          </tr>
        </thead>
        <tbody>
          {sortedTeams.map((t) => {
            const activeTs = activeSeason
              ? t.seasons.find((ts) => ts.seasonId === activeSeason.id)
              : undefined;
            return (
              <tr key={t.id}>
                <td className={tdClass}>
                  <Link href={`/admin/teams/${t.id}`} prefetch={false} className="text-slate-900 underline">
                    {t.name}
                  </Link>
                </td>
                <td className={tdClass}>{activeTs ? `${activeTs.ageGroup}u` : ""}</td>
                <td className={tdClass}>{activeTs?.teamNumber ?? ""}</td>
                <td className={`${tdClass} font-mono text-xs text-slate-500`}>
                  {activeTs?.externalTeamCode ?? ""}
                </td>
                <td className={tdClass}>
                  {(() => {
                    const rank = nationalRankByTeamId.get(t.id);
                    if (!rank) return "—";
                    if (rank <= 100) {
                      return (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                          {rank}
                        </span>
                      );
                    }
                    return rank;
                  })()}
                </td>
                <td className={tdClass}>
                  {t.seasons.length === 0 && (
                    <span className="text-slate-400">Not enrolled in any season</span>
                  )}
                  <ul className="flex flex-col gap-0.5">
                    {t.seasons.map((ts) => (
                      <li key={ts.id} className="text-xs text-slate-600">
                        {ts.season.label}: {ts.ageGroup}u #{ts.teamNumber}
                        {ts.externalTeamCode && (
                          <span className="font-mono text-slate-400"> ({ts.externalTeamCode})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            );
          })}
          {sortedTeams.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={6}>
                No teams for this club yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
