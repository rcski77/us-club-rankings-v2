import { NextRequest } from "next/server";
import { buildTeamRankingsWorkbook } from "@/lib/exportTeamRankings";
import { prisma } from "@/lib/prisma";
import { parseRankingGender, RANKING_GENDER_LABEL } from "@/lib/teamGender";

export async function GET(req: NextRequest) {
  const seasonId = req.nextUrl.searchParams.get("season");
  if (!seasonId) return new Response("Missing season", { status: 400 });
  const gender = parseRankingGender(req.nextUrl.searchParams.get("gender"));

  const [result, season] = await Promise.all([
    buildTeamRankingsWorkbook(seasonId, gender),
    prisma.season.findUnique({ where: { id: seasonId }, select: { label: true } }),
  ]);
  if (!result.ok) return new Response(result.reason, { status: 400 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${season?.label ?? seasonId} ${RANKING_GENDER_LABEL[gender]} Team Rankings.xlsx"`,
    },
  });
}
