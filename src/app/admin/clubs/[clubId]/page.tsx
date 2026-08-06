import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  inputClass,
  selectClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorBannerClass,
  successBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";
import { updateClub, mergeIntoThisClub } from "./actions";

export default async function ClubDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{
    error?: string;
    success?: string;
    mergeError?: string;
    teamsMoved?: string;
    conflicts?: string;
    mergeQ?: string;
  }>;
}) {
  const { clubId } = await params;
  const { error, success, mergeError, teamsMoved, conflicts, mergeQ } = await searchParams;

  // club, regions, and activeSeason don't depend on each other's results.
  const [club, regions, activeSeason] = await Promise.all([
    prisma.club.findUnique({
      where: { id: clubId },
      include: {
        region: true,
        contacts: true,
        mergedInto: true,
        mergedClubs: { include: { region: true }, orderBy: { name: "asc" } },
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

  const mergeCandidates = mergeQ
    ? await prisma.club.findMany({
        where: {
          id: { not: clubId },
          mergedIntoClubId: null,
          OR: [
            { name: { contains: mergeQ, mode: "insensitive" } },
            { externalCode: { contains: mergeQ, mode: "insensitive" } },
          ],
        },
        include: { region: true },
        orderBy: { name: "asc" },
        take: 25,
      })
    : [];

  const updateClubWithId = updateClub.bind(null, clubId);
  const mergeIntoThisClubWithId = mergeIntoThisClub.bind(null, clubId);

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
      {error === "no_source_selected" && (
        <p className={errorBannerClass}>Select at least one club to merge in.</p>
      )}
      {error === "merge_failed" && (
        <p className={errorBannerClass}>Merge failed: {mergeError ?? "unknown error"}</p>
      )}
      {success === "1" && <p className={successBannerClass}>Club saved.</p>}
      {success === "merged" && (
        <p className={successBannerClass}>
          Merged {teamsMoved ?? 0} team{teamsMoved === "1" ? "" : "s"} into {club.name}.
          {conflicts && conflicts !== "0" && (
            <>
              {" "}
              {conflicts} legacy annual-score row{conflicts === "1" ? "" : "s"} conflicted with an
              existing year on this club and were left on the original (now-retired) club below for
              manual review.
            </>
          )}
        </p>
      )}

      {club.mergedInto && (
        <p className="mb-6 rounded bg-amber-50 p-3 text-sm text-amber-800">
          This club was merged into{" "}
          <Link href={`/admin/clubs/${club.mergedInto.id}`} prefetch={false} className="underline">
            {club.mergedInto.name}
          </Link>
          . It&apos;s kept for historical reference only — edit and merge actions here are disabled.
        </p>
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

      {!club.mergedInto && (
        <section className="mb-8 max-w-lg">
          <h2 className="mb-2 text-lg font-medium">Merge another club into this one</h2>
          <p className="mb-2 text-xs text-slate-500">
            Use this when a club changed codes or two clubs combined into this one (e.g. a
            real-world club merger). The other club&apos;s teams and history move to this club, and
            the other club is retired (kept for reference, no longer shown in normal lists). Future
            imports still using its old code will resolve here automatically.
          </p>
          <form action={`/admin/clubs/${clubId}`} method="get" className="mb-3 flex gap-2">
            <input
              type="search"
              name="mergeQ"
              defaultValue={mergeQ ?? ""}
              placeholder="Search clubs by name or code…"
              className={`${inputClass} flex-1`}
            />
            <button type="submit" className={secondaryButtonClass}>
              Search
            </button>
          </form>

          {mergeQ && (
            <form action={mergeIntoThisClubWithId} className="flex flex-col gap-2">
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border p-2">
                {mergeCandidates.map((c) => (
                  <li key={c.id} className="text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="sourceClubIds" value={c.id} />
                      {c.name}
                      {c.region?.code && <span className="text-slate-400"> ({c.region.code})</span>}
                      {c.externalCode && (
                        <span className="font-mono text-xs text-slate-400"> {c.externalCode}</span>
                      )}
                    </label>
                  </li>
                ))}
                {mergeCandidates.length === 0 && (
                  <li className="text-sm text-slate-400">No matching clubs.</li>
                )}
              </ul>
              <button type="submit" className={`${primaryButtonClass} self-start`}>
                Merge selected into {club.name}
              </button>
            </form>
          )}
        </section>
      )}

      <h2 className="mb-2 text-lg font-medium">Teams</h2>
      {activeSeason && (
        <p className="mb-2 text-xs text-slate-500">
          Age, team #, and code shown are for the active season ({activeSeason.label}).
        </p>
      )}
      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Age</th>
            <th className={thClass}>Team #</th>
            <th className={thClass}>Team code</th>
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
              <td className={tdClass} colSpan={5}>
                No teams for this club yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
