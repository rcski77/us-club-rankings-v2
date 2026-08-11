import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  updateDivisionDetails,
  applyTemplate,
  addDivisionBand,
  removeDivisionBand,
  updateDivisionBandPoints,
  confirmDivisionScoring,
  unlockDivisionScoring,
  addTeamFinish,
  removeTeamFinish,
  updateTeamFinishRank,
  adjustDivisionBandPoints,
  searchAvailableTeams,
} from "./actions";
import { TeamCombobox } from "./TeamCombobox";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  selectClass,
  primaryButtonClass,
  secondaryButtonClass,
  smallSecondaryButtonClass,
  errorBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";

export default async function DivisionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string; divisionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { eventId, divisionId } = await params;
  const { error } = await searchParams;
  const session = await auth();
  const isSuperAdmin = session?.user.role === "SUPER_ADMIN";

  // `templates` doesn't depend on `division`, so fetch them concurrently.
  const [division, templates] = await Promise.all([
    prisma.division.findUnique({
      where: { id: divisionId },
      include: {
        event: true,
        pointBands: { orderBy: { fromRank: "asc" } },
      },
    }),
    prisma.pointTemplate.findMany({ orderBy: { maxPoints: "desc" } }),
  ]);
  if (!division || division.eventId !== eventId) notFound();

  const seasonId = division.event.seasonId;
  const seasonScopedTeam = { seasons: { where: { seasonId } } } as const;

  const finishes = await prisma.teamFinish.findMany({
    where: { divisionId },
    include: { team: { include: seasonScopedTeam } },
    orderBy: { rank: "asc" },
  });
  const isConfirmed = division.scoringStatus === "CONFIRMED";
  const updateDetailsWithIds = updateDivisionDetails.bind(null, eventId, divisionId);
  const applyTemplateWithIds = applyTemplate.bind(null, eventId, divisionId);
  const addBandWithIds = addDivisionBand.bind(null, eventId, divisionId);
  const addFinishWithIds = addTeamFinish.bind(null, eventId, divisionId);
  const adjustBandsWithIds = adjustDivisionBandPoints.bind(null, eventId, divisionId);

  // Best-to-worst division strength, USAV and AAU tiers merged into one order
  // (see docs/domain-notes.md) since both share this one dropdown/enum.
  const TIER_LABELS = [
    "OPEN",
    "PREMIER",
    "USA",
    "LIBERTY",
    "AMERICAN",
    "CLUB",
    "FREEDOM",
    "CLASSIC",
    "PATRIOT",
  ] as const;

  return (
    <div className="max-w-2xl">
      <Breadcrumbs
        items={[
          { label: "Events", href: "/admin/events" },
          { label: division.event.name, href: `/admin/events/${eventId}` },
          { label: division.name },
        ]}
      />
      <h1 className="mb-1 text-2xl font-semibold">{division.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {division.ageGroup}u · {division.tierLabel}
        {division.tierLevel ? ` ${division.tierLevel}` : ""} ·{" "}
        <span className={isConfirmed ? "font-medium text-green-700" : "font-medium text-amber-700"}>
          {division.scoringStatus}
        </span>{" "}
        ·{" "}
        <Link href={`/admin/events/${eventId}/divisions/${divisionId}/scoring`} className="underline">
          Scoring suggestion
        </Link>
      </p>

      {error === "invalid" && <p className={errorBannerClass}>Invalid band values.</p>}
      {error === "duplicate" && <p className={errorBannerClass}>A band already starts at that rank.</p>}
      {error === "nobands" && (
        <p className={errorBannerClass}>
          Apply a point template or add at least one band before confirming.
        </p>
      )}
      {error === "forbidden" && (
        <p className={errorBannerClass}>Only super admins can delete records.</p>
      )}
      {error === "division-invalid" && (
        <p className={errorBannerClass}>Name, age group, and tier are required.</p>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Edit division</h2>
        <form action={updateDetailsWithIds} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input name="name" defaultValue={division.name} required className={`${inputClass} w-56`} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Age group
            <input
              name="ageGroup"
              type="number"
              min={1}
              defaultValue={division.ageGroup}
              required
              className={`${inputClass} w-20`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tier
            <select name="tierLabel" className={selectClass} defaultValue={division.tierLabel}>
              {TIER_LABELS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tier level
            <input
              name="tierLevel"
              defaultValue={division.tierLevel ?? ""}
              placeholder="I / II"
              className={`${inputClass} w-20`}
            />
          </label>
          <button type="submit" className={secondaryButtonClass}>
            Save
          </button>
        </form>
        <p className="mt-1 text-xs text-slate-500">
          Correcting the age group here does not retroactively update the &quot;ignore
          age&quot; flag on finishes already entered — re-check those below if they
          were affected.
        </p>
      </section>

      <section className="mb-8">
        <div className="mb-2 flex items-center gap-3">
          <h2 className="text-lg font-medium">Point curve</h2>
          {!isConfirmed && division.pointBands.length > 0 && (
            <div className="flex items-center gap-1">
              <form action={adjustBandsWithIds}>
                <input type="hidden" name="delta" value="1" />
                <button type="submit" className={smallSecondaryButtonClass} title="Bump every band up 1 point">
                  +1 all
                </button>
              </form>
              <form action={adjustBandsWithIds}>
                <input type="hidden" name="delta" value="-1" />
                <button type="submit" className={smallSecondaryButtonClass} title="Bump every band down 1 point">
                  -1 all
                </button>
              </form>
            </div>
          )}
        </div>

        <table className={`${tableClass} mb-4`}>
          <thead>
            <tr>
              <th className={thClass}>From</th>
              <th className={thClass}>To</th>
              <th className={thClass}>Points</th>
              {!isConfirmed && <th className={thClass}></th>}
            </tr>
          </thead>
          <tbody>
            {division.pointBands.map((b) => (
              <tr key={b.id}>
                <td className={tdClass}>{b.fromRank}</td>
                <td className={tdClass}>{b.toRank === 0 ? "+" : b.toRank}</td>
                <td className={tdClass}>
                  {isConfirmed ? (
                    b.points
                  ) : (
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        await updateDivisionBandPoints(eventId, divisionId, b.id, formData);
                      }}
                      className="flex items-center gap-1"
                    >
                      <input
                        name="points"
                        type="number"
                        min={0}
                        defaultValue={b.points}
                        className={`${inputClass} w-20`}
                      />
                      <button type="submit" className={smallSecondaryButtonClass}>
                        Save
                      </button>
                    </form>
                  )}
                </td>
                {!isConfirmed && isSuperAdmin && (
                  <td className={tdClass}>
                    <form
                      action={async () => {
                        "use server";
                        await removeDivisionBand(eventId, divisionId, b.id);
                      }}
                    >
                      <button type="submit" className={smallSecondaryButtonClass}>
                        Remove
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {division.pointBands.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={isConfirmed ? 3 : 4}>
                  No bands yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {!isConfirmed && (
          <div className="flex flex-wrap items-end gap-6">
            <form action={applyTemplateWithIds} className="flex items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Apply point template
                <select name="pointTemplateId" className={selectClass} defaultValue="">
                  <option value="" disabled>
                    Select a template…
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.maxPoints} max)
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={secondaryButtonClass}>
                Apply
              </button>
            </form>

            <form action={addBandWithIds} className="flex items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                From
                <input name="fromRank" type="number" min={1} required className={`${inputClass} w-16`} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                To (0=+)
                <input name="toRank" type="number" min={0} required className={`${inputClass} w-16`} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Points
                <input name="points" type="number" min={0} required className={`${inputClass} w-20`} />
              </label>
              <button type="submit" className={secondaryButtonClass}>
                Add band
              </button>
            </form>
          </div>
        )}

        <div className="mt-4">
          {!isConfirmed ? (
            <form
              action={async () => {
                "use server";
                await confirmDivisionScoring(eventId, divisionId);
              }}
            >
              <SubmitButton className={primaryButtonClass} pendingText="Confirming...">
                Confirm scoring
              </SubmitButton>
            </form>
          ) : (
            <form
              action={async () => {
                "use server";
                await unlockDivisionScoring(eventId, divisionId);
              }}
            >
              <SubmitButton className={secondaryButtonClass} pendingText="Unlocking...">
                Unlock
              </SubmitButton>
            </form>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Team finishes</h2>

        {error === "finish-invalid" && (
          <p className={errorBannerClass}>Select a team and a rank.</p>
        )}
        {error === "finish-duplicate" && (
          <p className={errorBannerClass}>That team already has a finish in this division.</p>
        )}

        <table className={`${tableClass} mb-4`}>
          <thead>
            <tr>
              <th className={thClass}>Rank</th>
              <th className={thClass}>Team</th>
              <th className={thClass}>Age</th>
              <th className={thClass}>Ignore age</th>
              <th className={thClass}>Points</th>
              {!isConfirmed && <th className={thClass}></th>}
            </tr>
          </thead>
          <tbody>
            {finishes.map((f) => (
              <tr key={f.id}>
                <td className={tdClass}>
                  {isConfirmed ? (
                    f.rank
                  ) : (
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        await updateTeamFinishRank(eventId, divisionId, f.id, formData);
                      }}
                      className="flex items-center gap-1"
                    >
                      <input
                        name="rank"
                        type="number"
                        min={1}
                        defaultValue={f.rank}
                        className={`${inputClass} w-16`}
                      />
                      <button type="submit" className={smallSecondaryButtonClass}>
                        Save
                      </button>
                    </form>
                  )}
                </td>
                <td className={tdClass}>{f.team.name}</td>
                <td className={tdClass}>{f.team.seasons[0]?.ageGroup}u</td>
                <td className={tdClass}>{f.ignoreAge ? "Yes" : ""}</td>
                <td className={tdClass}>{f.points ?? ""}</td>
                {!isConfirmed && isSuperAdmin && (
                  <td className={tdClass}>
                    <form
                      action={async () => {
                        "use server";
                        await removeTeamFinish(eventId, divisionId, f.id);
                      }}
                    >
                      <button type="submit" className={smallSecondaryButtonClass}>
                        Remove
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {finishes.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={isConfirmed ? 5 : 6}>
                  No team finishes entered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {!isConfirmed && (
          <form action={addFinishWithIds} className="flex flex-wrap items-end gap-3">
            <TeamCombobox divisionId={divisionId} fieldName="teamId" searchAction={searchAvailableTeams} />
            <label className="flex flex-col gap-1 text-sm">
              Rank
              <input name="rank" type="number" min={1} required className={`${inputClass} w-16`} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input name="ignoreAge" type="checkbox" />
              Ignore age
            </label>
            <button type="submit" className={secondaryButtonClass}>
              Add finish
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
