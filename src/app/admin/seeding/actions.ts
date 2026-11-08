"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseTeamListXlsx } from "@/lib/seeding/parseTeamListXlsx";
import { buildSeedingReport } from "@/lib/seeding/buildSeedingReport";
import type { SeedingReport } from "@/lib/seeding/types";

export type SeedingActionState = {
  error: string | null;
  report: SeedingReport | null;
};

const MAX_BYTES = 4 * 1024 * 1024; // under next.config's 5mb server-action body limit

/**
 * Stateless: parse the uploaded team list, match + compute, and hand the report back to
 * the page (useActionState). Nothing is written to the database. Errors come back as
 * state rather than a redirect because there is no URL to carry an uploaded file's
 * result -- same banner convention as the other admin pages.
 */
export async function generateSeedingReport(
  _prev: SeedingActionState,
  formData: FormData,
): Promise<SeedingActionState> {
  const session = await auth();
  if (!session?.user || session.user.status !== "ACTIVE") {
    return { error: "Not authorized.", report: null };
  }

  const eventId = String(formData.get("eventId") ?? "");
  const file = formData.get("file");
  if (!eventId) return { error: "Choose an event.", report: null };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an .xlsx team list to upload.", report: null };
  if (file.size > MAX_BYTES) return { error: "File is too large (4 MB max).", report: null };

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return { error: "That event no longer exists.", report: null };

  const parsed = await parseTeamListXlsx(await file.arrayBuffer());
  if (parsed.fileError) return { error: parsed.fileError, report: null };

  try {
    const report = await buildSeedingReport({ rows: parsed.rows, eventId });
    return { error: null, report };
  } catch (err) {
    console.error("Seeding report failed", err);
    return { error: "Could not build the report. See server logs.", report: null };
  }
}
