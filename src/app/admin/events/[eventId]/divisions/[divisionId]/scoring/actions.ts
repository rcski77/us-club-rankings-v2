"use server";

import { prisma } from "@/lib/prisma";
import { computeDivisionScoringSuggestion } from "@/lib/rating/computeDivisionScoringSuggestion";
import { recomputeRankingsForDivision } from "@/lib/ranking/computeRanking";
import { resolvePoints } from "@/lib/scoring/resolvePoints";
import { redirect } from "next/navigation";

function scoringPath(eventId: string, divisionId: string) {
  return `/admin/events/${eventId}/divisions/${divisionId}/scoring`;
}

function divisionPath(eventId: string, divisionId: string) {
  return `/admin/events/${eventId}/divisions/${divisionId}`;
}

export async function generateSuggestion(eventId: string, divisionId: string) {
  await computeDivisionScoringSuggestion(divisionId);
  redirect(scoringPath(eventId, divisionId));
}

export async function acceptSuggestion(eventId: string, divisionId: string, snapshotId: string) {
  const snapshot = await prisma.divisionScoringSnapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    include: { suggestedTemplate: { include: { bands: true } } },
  });
  if (!snapshot.suggestedTemplate) {
    redirect(`${scoringPath(eventId, divisionId)}?error=nosuggestion`);
  }

  const finishes = await prisma.teamFinish.findMany({ where: { divisionId } });
  if (finishes.length === 0) {
    redirect(`${scoringPath(eventId, divisionId)}?error=nofinishes`);
  }

  const bands = snapshot.suggestedTemplate.bands;

  await prisma.$transaction([
    prisma.divisionPointBand.deleteMany({ where: { divisionId } }),
    prisma.divisionPointBand.createMany({
      data: bands.map((b) => ({ divisionId, fromRank: b.fromRank, toRank: b.toRank, points: b.points })),
    }),
    ...finishes.map((f) =>
      prisma.teamFinish.update({
        where: { id: f.id },
        data: { points: resolvePoints(f.rank, bands) },
      }),
    ),
    prisma.division.update({ where: { id: divisionId }, data: { scoringStatus: "CONFIRMED" } }),
    prisma.divisionScoringSnapshot.update({ where: { id: snapshotId }, data: { status: "ACCEPTED" } }),
  ]);

  await recomputeRankingsForDivision(divisionId);

  redirect(divisionPath(eventId, divisionId));
}

export async function overrideSuggestion(
  eventId: string,
  divisionId: string,
  snapshotId: string,
  formData: FormData,
) {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) redirect(`${scoringPath(eventId, divisionId)}?error=noreason`);

  await prisma.$transaction([
    prisma.divisionScoringSnapshot.update({
      where: { id: snapshotId },
      data: { status: "OVERRIDDEN", overrideReason: reason },
    }),
    prisma.division.update({ where: { id: divisionId }, data: { scoringStatus: "DRAFT" } }),
  ]);

  redirect(divisionPath(eventId, divisionId));
}
