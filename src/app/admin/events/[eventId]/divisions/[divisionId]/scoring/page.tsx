import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BUCKET_THRESHOLDS } from "@/lib/rating/fieldStrength";
import {
  getDivisionRatedRatings,
  getSeasonColleyRatingPopulation,
} from "@/lib/rating/computeDivisionFieldStrength";
import { computeRatingHistogram } from "@/lib/rating/ratingHistogram";
import { generateSuggestion, acceptSuggestion, overrideSuggestion } from "./actions";
import { RatingHistogramChart } from "./RatingHistogramChart";
import {
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string; divisionId: string }>;
}): Promise<Metadata> {
  const { divisionId } = await params;
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { name: true, ageGroup: true },
  });
  return { title: division ? `Scoring — ${division.name} (${division.ageGroup}u)` : "Scoring" };
}

export default async function DivisionScoringPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string; divisionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { eventId, divisionId } = await params;
  const { error } = await searchParams;

  const division = await prisma.division.findUnique({ where: { id: divisionId }, include: { event: true } });
  if (!division || division.eventId !== eventId) notFound();

  const snapshots = await prisma.divisionScoringSnapshot.findMany({
    where: { divisionId },
    include: { suggestedTemplate: true },
    orderBy: { createdAt: "desc" },
  });
  const snapshot = snapshots[0];
  const priorSnapshots = snapshots.slice(1);

  const generateWithIds = generateSuggestion.bind(null, eventId, divisionId);
  const bucketCounts = (snapshot?.bucketCounts as Record<string, number> | undefined) ?? {};
  const isPending = snapshot?.status === "PENDING" && division.scoringStatus === "SUGGESTED";

  const ratings = snapshot ? await getDivisionRatedRatings(divisionId) : [];
  const populationRatings = snapshot
    ? await getSeasonColleyRatingPopulation(division.event.seasonId, division.ageGroup)
    : [];
  const histogram =
    snapshot && ratings.length > 0
      ? computeRatingHistogram(
          populationRatings.length > 0 ? populationRatings : ratings,
          10,
          ratings,
        )
      : null;

  return (
    <div className="max-w-2xl">
      <Breadcrumbs
        items={[
          { label: "Events", href: "/admin/events" },
          { label: division.event.name, href: `/admin/events/${eventId}` },
          { label: division.name, href: `/admin/events/${eventId}/divisions/${divisionId}` },
          { label: "Scoring suggestion" },
        ]}
      />
      <h1 className="mb-1 text-2xl font-semibold">Scoring suggestion</h1>
      <p className="mb-6 text-sm text-slate-500">
        {division.name} · {division.ageGroup}u ·{" "}
        <span className="font-medium">{division.scoringStatus}</span>
      </p>

      {error === "nosuggestion" && (
        <p className={errorBannerClass}>This snapshot has no suggested template to accept.</p>
      )}
      {error === "nofinishes" && (
        <p className={errorBannerClass}>Enter team finishes before accepting a suggestion.</p>
      )}
      {error === "noreason" && (
        <p className={errorBannerClass}>An override reason is required.</p>
      )}

      <form action={generateWithIds} className="mb-6">
        <button type="submit" className={secondaryButtonClass}>
          {snapshot ? "Regenerate suggestion" : "Generate suggestion"}
        </button>
      </form>

      {!snapshot && <p className="text-sm text-slate-500">No suggestion generated yet.</p>}

      {snapshot && (
        <>
          <section className="mb-8 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className="text-slate-500">Rating engine</div>
            <div>{snapshot.ratingEngineUsed ?? "—"}</div>

            <div className="text-slate-500">Field Strength Score</div>
            <div>
              {snapshot.fss !== null
                ? snapshot.ratingEngineUsed === "ELO"
                  ? snapshot.fss.toFixed(0)
                  : snapshot.fss.toFixed(3)
                : "—"}
            </div>

            <div className="text-slate-500">Elite Presence</div>
            <div>{snapshot.elitePresence !== null ? `${snapshot.elitePresence.toFixed(0)}%` : "—"}</div>

            <div className="text-slate-500">Percentile (blended)</div>
            <div>{snapshot.percentile !== null ? `${snapshot.percentile.toFixed(0)}th` : "—"}</div>

            <div className="text-slate-500">Score band</div>
            <div>{snapshot.scoreBand ?? "—"}</div>

            <div className="text-slate-500">Teams / rated</div>
            <div>
              {snapshot.teamCount} / {snapshot.ratedTeamCount} (
              {(snapshot.percentTeamsRated * 100).toFixed(0)}% rated)
            </div>

            <div className="text-slate-500">Match volume</div>
            <div>{snapshot.matchVolume}</div>

            <div className="text-slate-500">Suggested template</div>
            <div>
              {snapshot.suggestedTemplate
                ? `${snapshot.suggestedTemplate.name} (${snapshot.suggestedTemplate.maxPoints} max)`
                : "—"}
            </div>

            <div className="text-slate-500">Snapshot status</div>
            <div>{snapshot.status}</div>
          </section>

          {snapshot.warnings.length > 0 && (
            <p className={errorBannerClass}>
              Confidence warnings: {snapshot.warnings.join(", ")}
            </p>
          )}

          <section className="mb-8">
            <h2 className="mb-2 text-lg font-medium">Bucket participation (by national rank)</h2>
            <table className={tableClass}>
              <thead>
                <tr>
                  {BUCKET_THRESHOLDS.map((t) => (
                    <th key={t} className={thClass}>
                      Top {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {BUCKET_THRESHOLDS.map((t) => (
                    <td key={t} className={tdClass}>
                      {bucketCounts[String(t)] ?? 0}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>

          <section className="mb-8">
            <h2 className="mb-2 text-lg font-medium">Colley rating distribution</h2>
            {ratings.length > 0 && histogram ? (
              <RatingHistogramChart histogram={histogram} />
            ) : (
              <p className="text-sm text-slate-500">No rated teams in this division yet.</p>
            )}
          </section>

          {isPending && (
            <section className="flex flex-wrap items-start gap-6">
              <form
                action={async () => {
                  "use server";
                  await acceptSuggestion(eventId, divisionId, snapshot.id);
                }}
              >
                <button type="submit" className={primaryButtonClass} disabled={!snapshot.suggestedTemplateId}>
                  Accept
                </button>
              </form>

              <form
                action={async (formData: FormData) => {
                  "use server";
                  await overrideSuggestion(eventId, divisionId, snapshot.id, formData);
                }}
                className="flex items-end gap-3"
              >
                <label className="flex flex-col gap-1 text-sm">
                  Override reason
                  <input name="reason" required className={`${inputClass} w-64`} />
                </label>
                <button type="submit" className={secondaryButtonClass}>
                  Override
                </button>
              </form>
            </section>
          )}

          {snapshot.status === "OVERRIDDEN" && snapshot.overrideReason && (
            <p className="text-sm text-slate-500">
              Overridden: {snapshot.overrideReason}
            </p>
          )}

          {priorSnapshots.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-2 text-lg font-medium">History</h2>
              <p className="mb-2 text-sm text-slate-500">
                How this division&apos;s FSS and suggested tier have shifted across prior
                runs — a division scored early, before its region&apos;s other results
                connect into the graph, can look weaker than it turns out to be.
              </p>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Run date</th>
                    <th className={thClass}>Engine</th>
                    <th className={thClass}>FSS</th>
                    <th className={thClass}>Elite %</th>
                    <th className={thClass}>Percentile</th>
                    <th className={thClass}>Band</th>
                    <th className={thClass}>Suggested template</th>
                    <th className={thClass}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.id} className={s.id === snapshot.id ? "font-medium" : undefined}>
                      <td className={tdClass}>
                        {s.createdAt.toLocaleDateString()} {s.createdAt.toLocaleTimeString()}
                        {s.id === snapshot.id ? " (current)" : ""}
                      </td>
                      <td className={tdClass}>{s.ratingEngineUsed ?? "—"}</td>
                      <td className={tdClass}>
                        {s.fss !== null
                          ? s.ratingEngineUsed === "ELO"
                            ? s.fss.toFixed(0)
                            : s.fss.toFixed(3)
                          : "—"}
                      </td>
                      <td className={tdClass}>
                        {s.elitePresence !== null ? `${s.elitePresence.toFixed(0)}%` : "—"}
                      </td>
                      <td className={tdClass}>
                        {s.percentile !== null ? `${s.percentile.toFixed(0)}th` : "—"}
                      </td>
                      <td className={tdClass}>{s.scoreBand ?? "—"}</td>
                      <td className={tdClass}>
                        {s.suggestedTemplate
                          ? `${s.suggestedTemplate.name} (${s.suggestedTemplate.maxPoints} max)`
                          : "—"}
                      </td>
                      <td className={tdClass}>{s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
