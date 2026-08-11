import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  smallSecondaryButtonClass,
  errorBannerClass,
  successBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";
import { mergeClubs, combineClubs, removeGroupMember } from "./actions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Club Groups" };

export default async function ClubGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
    mergeError?: string;
    teamsMoved?: string;
    yearsResolved?: string;
    yearsOverridden?: string;
    combineError?: string;
    clubsCombined?: string;
    mergeTargetQ?: string;
    mergeTargetId?: string;
    mergeSourceQ?: string;
    groupPrimaryQ?: string;
    groupPrimaryId?: string;
    groupMemberQ?: string;
  }>;
}) {
  const {
    error,
    success,
    mergeError,
    teamsMoved,
    yearsResolved,
    yearsOverridden,
    combineError,
    clubsCombined,
    mergeTargetQ,
    mergeTargetId,
    mergeSourceQ,
    groupPrimaryQ,
    groupPrimaryId,
    groupMemberQ,
  } = await searchParams;

  const [existingMerges, existingGroups] = await Promise.all([
    prisma.club.findMany({
      where: { mergedClubs: { some: {} } },
      include: { region: true, mergedClubs: { include: { region: true }, orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.club.findMany({
      where: { rankingGroupMembers: { some: {} } },
      include: {
        region: true,
        rankingGroupMembers: { include: { region: true }, orderBy: { name: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const [mergeTarget, mergeTargetCandidates] = await Promise.all([
    mergeTargetId ? prisma.club.findUnique({ where: { id: mergeTargetId } }) : null,
    !mergeTargetId && mergeTargetQ
      ? prisma.club.findMany({
          where: {
            mergedIntoClubId: null,
            OR: [
              { name: { contains: mergeTargetQ, mode: "insensitive" } },
              { externalCode: { contains: mergeTargetQ, mode: "insensitive" } },
            ],
          },
          include: { region: true },
          orderBy: { name: "asc" },
          take: 25,
        })
      : [],
  ]);

  const mergeSourceCandidates =
    mergeTarget && mergeSourceQ
      ? await prisma.club.findMany({
          where: {
            id: { not: mergeTarget.id },
            mergedIntoClubId: null,
            OR: [
              { name: { contains: mergeSourceQ, mode: "insensitive" } },
              { externalCode: { contains: mergeSourceQ, mode: "insensitive" } },
            ],
          },
          include: { region: true },
          orderBy: { name: "asc" },
          take: 25,
        })
      : [];

  const [groupPrimary, groupPrimaryCandidates] = await Promise.all([
    groupPrimaryId ? prisma.club.findUnique({ where: { id: groupPrimaryId } }) : null,
    !groupPrimaryId && groupPrimaryQ
      ? prisma.club.findMany({
          where: {
            mergedIntoClubId: null,
            rankingGroupPrimaryClubId: null,
            OR: [
              { name: { contains: groupPrimaryQ, mode: "insensitive" } },
              { externalCode: { contains: groupPrimaryQ, mode: "insensitive" } },
            ],
          },
          include: { region: true },
          orderBy: { name: "asc" },
          take: 25,
        })
      : [],
  ]);

  const groupMemberCandidates =
    groupPrimary && groupMemberQ
      ? await prisma.club.findMany({
          where: {
            id: { not: groupPrimary.id },
            mergedIntoClubId: null,
            rankingGroupPrimaryClubId: null,
            rankingGroupMembers: { none: {} }, // exclude clubs already a primary elsewhere -- no nested groups
            OR: [
              { name: { contains: groupMemberQ, mode: "insensitive" } },
              { externalCode: { contains: groupMemberQ, mode: "insensitive" } },
            ],
          },
          include: { region: true },
          orderBy: { name: "asc" },
          take: 25,
        })
      : [];

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Club Groups</h1>
      <p className="mb-6 max-w-2xl text-sm text-slate-500">
        Manage clubs that changed codes, real-world club mergers, and clubs that should share a
        combined Club Rankings entry — see each section below for when to use which.
      </p>

      {error === "no_target" && <p className={errorBannerClass}>Select a target club first.</p>}
      {error === "no_source_selected" && (
        <p className={errorBannerClass}>Select at least one club to merge in.</p>
      )}
      {error === "merge_failed" && (
        <p className={errorBannerClass}>Merge failed: {mergeError ?? "unknown error"}</p>
      )}
      {error === "no_primary" && <p className={errorBannerClass}>Select a primary club first.</p>}
      {error === "no_member_selected" && (
        <p className={errorBannerClass}>Select at least one club to combine in.</p>
      )}
      {error === "combine_failed" && (
        <p className={errorBannerClass}>Combine failed: {combineError ?? "unknown error"}</p>
      )}
      {success === "merged" && (
        <p className={successBannerClass}>
          Merged, moving {teamsMoved ?? 0} team{teamsMoved === "1" ? "" : "s"}.
          {yearsResolved && yearsResolved !== "0" && (
            <>
              {" "}
              {yearsResolved} legacy annual-score year{yearsResolved === "1" ? "" : "s"} existed on
              both clubs — the higher score won each time
              {yearsOverridden && yearsOverridden !== "0" ? (
                <> ({yearsOverridden} of them took the merged-in club&apos;s higher score).</>
              ) : (
                <> (the target club&apos;s own score was already higher every time).</>
              )}
            </>
          )}
        </p>
      )}
      {success === "combined" && (
        <p className={successBannerClass}>
          Combined {clubsCombined ?? 0} club{clubsCombined === "1" ? "" : "s"} for club rankings.
        </p>
      )}
      {success === "removed_from_group" && (
        <p className={successBannerClass}>Removed from its ranking group.</p>
      )}

      {/* --- Merges ------------------------------------------------------- */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-medium">Merges</h2>
        <p className="mb-3 max-w-2xl text-sm text-slate-500">
          Use when a club changed codes or a real-world club merger combined two clubs into one
          (e.g. two previously-separate clubs that merged under a new code). The source club&apos;s
          teams and history move to the target, and the source club is retired (kept for reference).
          For a year where both clubs already have a legacy annual score, the higher of the two wins
          on the target. Future imports still using its old code resolve to the target automatically.
        </p>

        {existingMerges.length > 0 && (
          <table className={`${tableClass} mb-4 max-w-3xl`}>
            <thead>
              <tr>
                <th className={thClass}>Target club</th>
                <th className={thClass}>Merged-in (retired) clubs</th>
              </tr>
            </thead>
            <tbody>
              {existingMerges.map((c) => (
                <tr key={c.id}>
                  <td className={tdClass}>
                    <Link href={`/admin/clubs/${c.id}`} prefetch={false} className="text-slate-900 underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className={tdClass}>
                    <ul className="flex flex-col gap-0.5">
                      {c.mergedClubs.map((m) => (
                        <li key={m.id}>
                          <Link href={`/admin/clubs/${m.id}`} prefetch={false} className="underline">
                            {m.name}
                          </Link>
                          {m.region?.code && <span className="text-slate-400"> ({m.region.code})</span>}
                          {m.externalCode && (
                            <span className="font-mono text-xs text-slate-400"> {m.externalCode}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="max-w-lg">
          {!mergeTarget ? (
            <>
              <form action="/admin/club-groups" method="get" className="mb-3 flex gap-2">
                <input
                  type="search"
                  name="mergeTargetQ"
                  defaultValue={mergeTargetQ ?? ""}
                  placeholder="Search for the surviving (target) club…"
                  className={`${inputClass} flex-1`}
                />
                <button type="submit" className={secondaryButtonClass}>
                  Search
                </button>
              </form>
              {mergeTargetQ && (
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border p-2">
                  {mergeTargetCandidates.map((c) => (
                    <li key={c.id} className="text-sm">
                      <Link
                        href={`/admin/club-groups?mergeTargetId=${c.id}`}
                        prefetch={false}
                        className="underline"
                      >
                        {c.name}
                      </Link>
                      {c.region?.code && <span className="text-slate-400"> ({c.region.code})</span>}
                      {c.externalCode && (
                        <span className="font-mono text-xs text-slate-400"> {c.externalCode}</span>
                      )}
                    </li>
                  ))}
                  {mergeTargetCandidates.length === 0 && (
                    <li className="text-sm text-slate-400">No matching clubs.</li>
                  )}
                </ul>
              )}
            </>
          ) : (
            <>
              <p className="mb-3 text-sm">
                Target: <span className="font-medium">{mergeTarget.name}</span>{" "}
                <Link href="/admin/club-groups" prefetch={false} className="text-xs underline">
                  change
                </Link>
              </p>
              <form action="/admin/club-groups" method="get" className="mb-3 flex gap-2">
                <input type="hidden" name="mergeTargetId" value={mergeTarget.id} />
                <input
                  type="search"
                  name="mergeSourceQ"
                  defaultValue={mergeSourceQ ?? ""}
                  placeholder="Search clubs to merge in…"
                  className={`${inputClass} flex-1`}
                />
                <button type="submit" className={secondaryButtonClass}>
                  Search
                </button>
              </form>
              {mergeSourceQ && (
                <form action={mergeClubs} className="flex flex-col gap-2">
                  <input type="hidden" name="targetClubId" value={mergeTarget.id} />
                  <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border p-2">
                    {mergeSourceCandidates.map((c) => (
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
                    {mergeSourceCandidates.length === 0 && (
                      <li className="text-sm text-slate-400">No matching clubs.</li>
                    )}
                  </ul>
                  <button type="submit" className={`${primaryButtonClass} self-start`}>
                    Merge selected into {mergeTarget.name}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </section>

      {/* --- Ranking groups ------------------------------------------------ */}
      <section className="mb-10">
        <h2 className="mb-1 text-lg font-medium">Ranking groups</h2>
        <p className="mb-3 max-w-2xl text-sm text-slate-500">
          Use when two clubs are both real, active, independently-run programs (e.g. two locations
          of one club, each with its own code) but should be scored as one entry on the Club
          Rankings page. Unlike a merge, member clubs keep their own teams, imports, and detail
          pages — only their best-per-age-group finishes fold into the primary club&apos;s score, and
          they stop getting their own separate Club Rankings entry.
        </p>

        {existingGroups.length > 0 && (
          <table className={`${tableClass} mb-4 max-w-3xl`}>
            <thead>
              <tr>
                <th className={thClass}>Primary (displayed) club</th>
                <th className={thClass}>Combined members</th>
              </tr>
            </thead>
            <tbody>
              {existingGroups.map((c) => (
                <tr key={c.id}>
                  <td className={tdClass}>
                    <Link href={`/admin/clubs/${c.id}`} prefetch={false} className="text-slate-900 underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className={tdClass}>
                    <ul className="flex flex-col gap-1">
                      {c.rankingGroupMembers.map((m) => (
                        <li key={m.id} className="flex items-center gap-2">
                          <Link href={`/admin/clubs/${m.id}`} prefetch={false} className="underline">
                            {m.name}
                          </Link>
                          {m.region?.code && <span className="text-slate-400"> ({m.region.code})</span>}
                          {m.externalCode && (
                            <span className="font-mono text-xs text-slate-400"> {m.externalCode}</span>
                          )}
                          <form action={removeGroupMember}>
                            <input type="hidden" name="clubId" value={m.id} />
                            <button type="submit" className={smallSecondaryButtonClass}>
                              Remove
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="max-w-lg">
          {!groupPrimary ? (
            <>
              <form action="/admin/club-groups" method="get" className="mb-3 flex gap-2">
                <input
                  type="search"
                  name="groupPrimaryQ"
                  defaultValue={groupPrimaryQ ?? ""}
                  placeholder="Search for the club to display the combined score under…"
                  className={`${inputClass} flex-1`}
                />
                <button type="submit" className={secondaryButtonClass}>
                  Search
                </button>
              </form>
              {groupPrimaryQ && (
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border p-2">
                  {groupPrimaryCandidates.map((c) => (
                    <li key={c.id} className="text-sm">
                      <Link
                        href={`/admin/club-groups?groupPrimaryId=${c.id}`}
                        prefetch={false}
                        className="underline"
                      >
                        {c.name}
                      </Link>
                      {c.region?.code && <span className="text-slate-400"> ({c.region.code})</span>}
                      {c.externalCode && (
                        <span className="font-mono text-xs text-slate-400"> {c.externalCode}</span>
                      )}
                    </li>
                  ))}
                  {groupPrimaryCandidates.length === 0 && (
                    <li className="text-sm text-slate-400">No matching clubs.</li>
                  )}
                </ul>
              )}
            </>
          ) : (
            <>
              <p className="mb-3 text-sm">
                Primary: <span className="font-medium">{groupPrimary.name}</span>{" "}
                <Link href="/admin/club-groups" prefetch={false} className="text-xs underline">
                  change
                </Link>
              </p>
              <form action="/admin/club-groups" method="get" className="mb-3 flex gap-2">
                <input type="hidden" name="groupPrimaryId" value={groupPrimary.id} />
                <input
                  type="search"
                  name="groupMemberQ"
                  defaultValue={groupMemberQ ?? ""}
                  placeholder="Search clubs to combine in…"
                  className={`${inputClass} flex-1`}
                />
                <button type="submit" className={secondaryButtonClass}>
                  Search
                </button>
              </form>
              {groupMemberQ && (
                <form action={combineClubs} className="flex flex-col gap-2">
                  <input type="hidden" name="primaryClubId" value={groupPrimary.id} />
                  <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border p-2">
                    {groupMemberCandidates.map((c) => (
                      <li key={c.id} className="text-sm">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="memberClubIds" value={c.id} />
                          {c.name}
                          {c.region?.code && <span className="text-slate-400"> ({c.region.code})</span>}
                          {c.externalCode && (
                            <span className="font-mono text-xs text-slate-400"> {c.externalCode}</span>
                          )}
                        </label>
                      </li>
                    ))}
                    {groupMemberCandidates.length === 0 && (
                      <li className="text-sm text-slate-400">No matching clubs.</li>
                    )}
                  </ul>
                  <button type="submit" className={`${primaryButtonClass} self-start`}>
                    Combine selected with {groupPrimary.name} for rankings
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
