"use server";

import { prisma } from "@/lib/prisma";
import { recomputeRankingsForDivision } from "@/lib/ranking/computeRanking";
import { resolvePoints } from "@/lib/scoring/resolvePoints";
import { computeDivisionScoringSuggestion } from "@/lib/rating/computeDivisionScoringSuggestion";
import { redirect } from "next/navigation";

function divisionPath(eventId: string, divisionId: string) {
  return `/admin/events/${eventId}/divisions/${divisionId}`;
}

const TIER_LABELS = ["OPEN", "NATIONAL", "AMERICAN", "PATRIOT", "LIBERTY", "USA", "FREEDOM"] as const;

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
