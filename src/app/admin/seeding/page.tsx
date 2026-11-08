import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { SeedingTool } from "./SeedingTool";

export const metadata: Metadata = { title: "Seeding report" };

export default async function SeedingPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { event } = await searchParams;
  const events = await prisma.event.findMany({
    orderBy: { startDate: "desc" },
    take: 200,
    select: { id: true, name: true, startDate: true, season: { select: { label: true } } },
  });

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Seeding report</h1>
      <p className="mb-6 max-w-3xl text-sm text-slate-600">
        Upload the team list exported from Sportwrench/Otto (.xlsx) for an event. Teams are matched by
        code to our records and listed per division by power rank, with NPS points, data-confidence
        and flags for where a seeding decision is uncertain. Nothing is saved.
      </p>
      <SeedingTool
        defaultEventId={event ?? events[0]?.id ?? ""}
        events={events.map((e) => ({
          id: e.id,
          label: `${e.name} (${e.season.label}${e.startDate ? `, ${e.startDate.toISOString().slice(0, 10)}` : ""})`,
        }))}
      />
    </div>
  );
}
