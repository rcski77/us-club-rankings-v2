"use server";

import { prisma } from "@/lib/prisma";
import { recomputeRankingsForDivision } from "@/lib/ranking/computeRanking";
import { resolvePoints } from "@/lib/scoring/resolvePoints";
import { computeDivisionScoringSuggestion } from "@/lib/rating/computeDivisionScoringSuggestion";
import { redirect } from "next/navigation";

function divisionPath(eventId: string, divisionId: string) {
  return `/admin/events/${eventId}/divisions/${divisionId}`;
}

const TIER_LABELS = [
  "OPEN",
  "AMERICAN",
  "PATRIOT",
  "LIBERTY",
  "USA",
  "FREEDOM",
  "PREMIER",
  "CLUB",
  "CLASSIC",
] as const;

export async function updateDivisionDetails(eventId: string, divisionId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const ageGroup = Number(formData.get("ageGroup"));
  const tierLabel = String(formData.get("tierLabel") ?? "");
  const tierLevel = String(formData.get("tierLevel") ?? "").trim() || null;

  if (!name || !ageGroup || !TIER_LABELS.includes(tierLabel as (typeof TIER_LABELS)[number])) {
    redirect(`${divisionPath(eventId, divisionId)}?error=division-invalid`);
  }

  await prisma.division.update({
    where: { id: divisionId },
    data: { name, ageGroup, tierLabel: tierLabel as (typeof TIER_LABELS)[number], tierLevel },
  });

  redirect(divisionPath(eventId, divisionId));
}

export async function applyTemplate(
  eventId: string,
  divisionId: string,
  formData: FormData,
) {
  const pointTemplateId = String(formData.get("pointTemplateId") ?? "");
  if (!pointTemplateId) redirect(`${divisionPath(eventId, divisionId)}?error=invalid`);

  const template = await prisma.pointTemplate.findUnique({
    where: { id: pointTemplateId },
    include: { bands: true },
  });
  if (!template) redirect(`${divisionPath(eventId, divisionId)}?error=invalid`);

  await prisma.$transaction([
    prisma.divisionPointBand.deleteMany({ where: { divisionId } }),
    prisma.divisionPointBand.createMany({
      data: template.bands.map((b) => ({
        divisionId,
        fromRank: b.fromRank,
        toRank: b.toRank,
        points: b.points,
      })),
    }),
    prisma.division.update({ where: { id: divisionId }, data: { scoringStatus: "DRAFT" } }),
  ]);

  redirect(divisionPath(eventId, divisionId));
}

export async function addDivisionBand(eventId: string, divisionId: string, formData: FormData) {
  const fromRank = Number(formData.get("fromRank"));
  const toRank = Number(formData.get("toRank"));
  const points = Number(formData.get("points"));

  if (!fromRank || Number.isNaN(toRank) || Number.isNaN(points)) {
    redirect(`${divisionPath(eventId, divisionId)}?error=invalid`);
  }

  const existing = await prisma.divisionPointBand.findUnique({
    where: { divisionId_fromRank: { divisionId, fromRank } },
  });
  if (existing) redirect(`${divisionPath(eventId, divisionId)}?error=duplicate`);

  await prisma.divisionPointBand.create({ data: { divisionId, fromRank, toRank, points } });
  redirect(divisionPath(eventId, divisionId));
}

export async function removeDivisionBand(eventId: string, divisionId: string, bandId: string) {
  await prisma.divisionPointBand.delete({ where: { id: bandId } });
  redirect(divisionPath(eventId, divisionId));
}

export async function updateDivisionBandPoints(
  eventId: string,
  divisionId: string,
  bandId: string,
  formData: FormData,
) {
  const points = Number(formData.get("points"));
  if (Number.isNaN(points)) redirect(`${divisionPath(eventId, divisionId)}?error=invalid`);

  await prisma.divisionPointBand.update({ where: { id: bandId }, data: { points } });
  redirect(divisionPath(eventId, divisionId));
}

export async function adjustDivisionBandPoints(
  eventId: string,
  divisionId: string,
  formData: FormData,
) {
  const delta = Number(formData.get("delta"));
  if (!delta) redirect(`${divisionPath(eventId, divisionId)}?error=invalid`);

  // Skip bands that would go negative rather than clamping to 0, so a -1 nudge
  // never silently flattens a low band to the same points as the one below it.
  await prisma.divisionPointBand.updateMany({
    where: delta < 0 ? { divisionId, points: { gte: -delta } } : { divisionId },
    data: { points: { increment: delta } },
  });

  redirect(divisionPath(eventId, divisionId));
}

export async function confirmDivisionScoring(eventId: string, divisionId: string) {
  const division = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    include: { pointBands: true, finishes: true },
  });

  if (division.pointBands.length === 0) {
    redirect(`${divisionPath(eventId, divisionId)}?error=nobands`);
  }

  // Confirming here bypasses the suggestion-review screen (manual apply-template
  // flow), which is the only other place a DivisionScoringSnapshot gets created.
  // Generate one here too so the Analysis view has FSS/percentile/band data for every
  // confirmed division, not just ones that went through the suggestion flow.
  await computeDivisionScoringSuggestion(divisionId);

  await prisma.$transaction([
    ...division.finishes.map((f) =>
      prisma.teamFinish.update({
        where: { id: f.id },
        data: { points: resolvePoints(f.rank, division.pointBands) },
      }),
    ),
    prisma.division.update({ where: { id: divisionId }, data: { scoringStatus: "CONFIRMED" } }),
  ]);

  await recomputeRankingsForDivision(divisionId);

  redirect(divisionPath(eventId, divisionId));
}

export async function unlockDivisionScoring(eventId: string, divisionId: string) {
  await prisma.division.update({ where: { id: divisionId }, data: { scoringStatus: "DRAFT" } });
  // Drop this division's now-unconfirmed contributions from any ranking they fed.
  await recomputeRankingsForDivision(divisionId);
  redirect(divisionPath(eventId, divisionId));
}

export async function addTeamFinish(eventId: string, divisionId: string, formData: FormData) {
  const teamId = String(formData.get("teamId") ?? "");
  const rank = Number(formData.get("rank"));
  const ignoreAge = formData.get("ignoreAge") === "on";

  if (!teamId || !rank) redirect(`${divisionPath(eventId, divisionId)}?error=finish-invalid`);

  const existing = await prisma.teamFinish.findUnique({
    where: { divisionId_teamId: { divisionId, teamId } },
  });
  if (existing) redirect(`${divisionPath(eventId, divisionId)}?error=finish-duplicate`);

  await prisma.teamFinish.create({ data: { divisionId, teamId, rank, ignoreAge } });
  redirect(divisionPath(eventId, divisionId));
}

// Called directly from the client TeamCombobox (not a form action) -- the season this
// division belongs to can have thousands of teams, so search server-side instead of
// shipping the whole roster to the browser as <option> elements.
export async function searchAvailableTeams(divisionId: string, query: string) {
  const q = query.trim();
  if (q.length < 2) return [];

  const division = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    select: { event: { select: { seasonId: true } } },
  });
  const finishes = await prisma.teamFinish.findMany({ where: { divisionId }, select: { teamId: true } });
  const excludeIds = finishes.map((f) => f.teamId);

  const teams = await prisma.team.findMany({
    where: {
      id: { notIn: excludeIds },
      seasons: { some: { seasonId: division.event.seasonId } },
      name: { contains: q, mode: "insensitive" },
    },
    select: { id: true, name: true, seasons: { where: { seasonId: division.event.seasonId }, select: { ageGroup: true } } },
    orderBy: { name: "asc" },
    take: 20,
  });

  return teams.map((t) => ({ id: t.id, name: t.name, ageGroup: t.seasons[0]?.ageGroup ?? null }));
}

export async function removeTeamFinish(eventId: string, divisionId: string, finishId: string) {
  await prisma.teamFinish.delete({ where: { id: finishId } });
  redirect(divisionPath(eventId, divisionId));
}

export async function updateTeamFinishRank(
  eventId: string,
  divisionId: string,
  finishId: string,
  formData: FormData,
) {
  const rank = Number(formData.get("rank"));
  if (!rank) redirect(`${divisionPath(eventId, divisionId)}?error=finish-invalid`);

  await prisma.teamFinish.update({ where: { id: finishId }, data: { rank } });
  redirect(divisionPath(eventId, divisionId));
}
