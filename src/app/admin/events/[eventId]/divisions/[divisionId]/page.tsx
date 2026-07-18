import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  applyTemplate,
  addDivisionBand,
  removeDivisionBand,
  confirmDivisionScoring,
  unlockDivisionScoring,
  addTeamFinish,
  removeTeamFinish,
  updateTeamFinishRank,
} from "./actions";
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

  const [division, templates] = await Promise.all([
    prisma.division.findUnique({
      where: { id: divisionId },
      include: {
        event: true,
        pointBands: { orderBy: { fromRank: "asc" } },
        finishes: { include: { team: true }, orderBy: { rank: "asc" } },
      },
    }),
    prisma.pointTemplate.findMany({ orderBy: { maxPoints: "desc" } }),
  ]);
  if (!division || division.eventId !== eventId) notFound();

  const teams = await prisma.team.findMany({
    where: { seasonId: division.event.seasonId },
    orderBy: [{ ageGroup: "desc" }, { name: "asc" }],
  });
  const finishedTeamIds = new Set(division.finishes.map((f) => f.teamId));
  const availableTeams = teams.filter((t) => !finishedTeamIds.has(t.id));

  const isConfirmed = division.scoringStatus === "CONFIRMED";
  const applyTemplateWithIds = applyTemplate.bind(null, eventId, divisionId);
  const addBandWithIds = addDivisionBand.bind(null, eventId, divisionId);
  const addFinishWithIds = addTeamFinish.bind(null, eventId, divisionId);

  return (
    <div className="max-w-2xl">
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/events" className="underline">
          Events
        </Link>{" "}
        /{" "}
        <Link href={`/admin/events/${eventId}`} className="underline">
          {division.event.name}
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-semibold">{division.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {division.ageGroup}u · {division.tierLabel}
        {division.tierLevel ? ` ${division.tierLevel}` : ""} ·{" "}
        <span className={isConfirmed ? "font-medium text-green-700" : "font-medium text-amber-700"}>
          {division.scoringStatus}
        </span>
      </p>

      {error === "invalid" && <p className={errorBannerClass}>Invalid band values.</p>}
      {error === "duplicate" && <p className={errorBannerClass}>A band already starts at that rank.</p>}
      {error === "nobands" && (
        <p className={errorBannerClass}>
          Apply a point template or add at least one band before confirming.
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Point curve</h2>

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
                <td className={tdClass}>{b.points}</td>
                {!isConfirmed && (
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
              <button type="submit" className={primaryButtonClass}>
                Confirm scoring
              </button>
            </form>
          ) : (
            <form
              action={async () => {
                "use server";
                await unlockDivisionScoring(eventId, divisionId);
              }}
            >
              <button type="submit" className={secondaryButtonClass}>
                Unlock
              </button>
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
            {division.finishes.map((f) => (
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
                <td className={tdClass}>{f.team.ageGroup}u</td>
                <td className={tdClass}>{f.ignoreAge ? "Yes" : ""}</td>
                <td className={tdClass}>{f.points ?? ""}</td>
                {!isConfirmed && (
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
            {division.finishes.length === 0 && (
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
            <label className="flex flex-col gap-1 text-sm">
              Team
              <select name="teamId" className={selectClass} defaultValue="" required>
                <option value="" disabled>
                  Select a team…
                </option>
                {availableTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.ageGroup}u)
                  </option>
                ))}
              </select>
            </label>
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
