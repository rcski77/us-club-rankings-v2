import { NextRequest } from "next/server";
import { buildTeamRankingsWorkbook } from "@/lib/exportTeamRankings";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const seasonId = req.nextUrl.searchParams.get("season");
  if (!seasonId) return new Response("Missing season", { status: 400 });

  const [result, season] = await Promise.all([
    buildTeamRankingsWorkbook(seasonId),
    prisma.season.findUnique({ where: { id: seasonId }, select: { label: true } }),
  ]);
  if (!result.ok) return new Response(result.reason, { status: 400 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${season?.label ?? seasonId} Team Rankings.xlsx"`,
    },
  });
}
