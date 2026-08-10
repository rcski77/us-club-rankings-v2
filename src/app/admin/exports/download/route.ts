import { NextRequest } from "next/server";
import { buildClubRankingsWorkbook } from "@/lib/exportClubRankings";

export async function GET(req: NextRequest) {
  const endYear = Number(req.nextUrl.searchParams.get("endYear"));
  if (!endYear) return new Response("Missing endYear", { status: 400 });

  const result = await buildClubRankingsWorkbook(endYear);
  if (!result.ok) return new Response(result.reason, { status: 400 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${endYear} Rankings for Publish.xlsx"`,
    },
  });
}
