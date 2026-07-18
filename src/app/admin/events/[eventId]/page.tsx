import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  inputClass,
  selectClass,
  primaryButtonClass,
  errorBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";
import { uniqueSlug } from "@/lib/slug";
import type { DivisionTierLabel } from "@/generated/prisma/enums";

const TIER_LABELS: DivisionTierLabel[] = [
  "OPEN",
  "NATIONAL",
  "AMERICAN",
  "PATRIOT",
  "LIBERTY",
  "USA",
  "FREEDOM",
];

async function createDivision(eventId: string, formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const ageGroup = Number(formData.get("ageGroup"));
  const tierLabel = String(formData.get("tierLabel") ?? "") as DivisionTierLabel;
  const tierLevel = String(formData.get("tierLevel") ?? "").trim() || null;

  if (!name || !ageGroup || !TIER_LABELS.includes(tierLabel)) {
    redirect(`/admin/events/${eventId}?error=invalid`);
  }

  const slug = await uniqueSlug(name, async (candidate) => {
    const existing = await prisma.division.findUnique({
      where: { eventId_slug: { eventId, slug: candidate } },
    });
    return existing !== null;
  });

  await prisma.division.create({
    data: { eventId, name, slug, ageGroup, tierLabel, tierLevel },
  });

  redirect(`/admin/events/${eventId}`);
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { eventId } = await params;
  const { error } = await searchParams;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      season: true,
      divisions: {
        orderBy: [{ ageGroup: "desc" }, { name: "asc" }],
        include: { _count: { select: { finishes: true } } },
      },
    },
  });
  if (!event) notFound();

  const createDivisionWithEvent = createDivision.bind(null, eventId);

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/events" className="underline">
          Events
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-semibold">{event.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {event.season.label} · {event.startDate.toISOString().slice(0, 10)} –{" "}
        {event.endDate.toISOString().slice(0, 10)}
        {event.isAnchor && " · Anchor event"}
      </p>

      {error === "invalid" && (
        <p className={errorBannerClass}>Name, age group, and tier are required.</p>
      )}

      <table className={`${tableClass} mb-8`}>
        <thead>
          <tr>
            <th className={thClass}>Division</th>
            <th className={thClass}>Age</th>
            <th className={thClass}>Tier</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Finishes</th>
          </tr>
        </thead>
        <tbody>
          {event.divisions.map((d) => (
            <tr key={d.id}>
              <td className={tdClass}>
                <Link
                  href={`/admin/events/${event.id}/divisions/${d.id}`}
                  className="text-slate-900 underline"
                >
                  {d.name}
                </Link>
              </td>
              <td className={tdClass}>{d.ageGroup}u</td>
              <td className={tdClass}>
                {d.tierLabel}
                {d.tierLevel ? ` ${d.tierLevel}` : ""}
              </td>
              <td className={tdClass}>{d.scoringStatus}</td>
              <td className={tdClass}>{d._count.finishes}</td>
            </tr>
          ))}
          {event.divisions.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={5}>
                No divisions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-medium">Add division</h2>
      <form action={createDivisionWithEvent} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input name="name" placeholder="17 Open" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Age group
          <input
            name="ageGroup"
            type="number"
            min={10}
            max={18}
            required
            className={`${inputClass} w-20`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tier
          <select name="tierLabel" className={selectClass} defaultValue="OPEN">
            {TIER_LABELS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tier level
          <input name="tierLevel" placeholder="I" className={`${inputClass} w-20`} />
        </label>
        <button type="submit" className={primaryButtonClass}>
          Add division
        </button>
      </form>
    </div>
  );
}
