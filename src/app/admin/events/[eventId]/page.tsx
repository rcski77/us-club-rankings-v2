import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import {
  inputClass,
  selectClass,
  primaryButtonClass,
  errorBannerClass,
  successBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";
import { uniqueSlug } from "@/lib/slug";
import type { DivisionTierLabel, ImportSource } from "@/generated/prisma/enums";

const TIER_LABELS: DivisionTierLabel[] = [
  "OPEN",
  "NATIONAL",
  "AMERICAN",
  "PATRIOT",
  "LIBERTY",
  "USA",
  "FREEDOM",
];

const SCHEDULE_SOURCES: ImportSource[] = ["AES", "SPORTWRENCH", "TM2", "VBSCHEDULE"];

async function updateEvent(eventId: string, formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const startDateRaw = String(formData.get("startDate") ?? "");
  const endDateRaw = String(formData.get("endDate") ?? "");
  const isAnchor = formData.get("isAnchor") === "on";
  const addressLine = String(formData.get("addressLine") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const state = String(formData.get("state") ?? "").trim() || null;
  const zip = String(formData.get("zip") ?? "").trim() || null;
  const scheduleUrl = String(formData.get("scheduleUrl") ?? "").trim() || null;
  const scheduleSourceRaw = String(formData.get("scheduleSource") ?? "").trim();
  const scheduleSource = SCHEDULE_SOURCES.includes(scheduleSourceRaw as ImportSource)
    ? (scheduleSourceRaw as ImportSource)
    : null;

  const startDate = startDateRaw ? new Date(startDateRaw) : null;
  const endDate = endDateRaw ? new Date(endDateRaw) : null;

  if (!name || !startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    redirect(`/admin/events/${eventId}?error=invalid`);
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { name, startDate, endDate, isAnchor, addressLine, city, state, zip, scheduleUrl, scheduleSource },
  });

  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/events");
  redirect(`/admin/events/${eventId}?success=1`);
}

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
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { eventId } = await params;
  const { error, success } = await searchParams;

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
  const updateEventWithId = updateEvent.bind(null, eventId);

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
        <p className={errorBannerClass}>Name and valid start/end dates are required.</p>
      )}
      {success === "1" && <p className={successBannerClass}>Event saved.</p>}

      <section className="mb-8 max-w-lg">
        <h2 className="mb-2 text-lg font-medium">Edit event</h2>
        <form action={updateEventWithId} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input name="name" defaultValue={event.name} required className={inputClass} />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Start date
              <input
                name="startDate"
                type="date"
                defaultValue={event.startDate.toISOString().slice(0, 10)}
                required
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              End date
              <input
                name="endDate"
                type="date"
                defaultValue={event.endDate.toISOString().slice(0, 10)}
                required
                className={inputClass}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Address
            <input name="addressLine" defaultValue={event.addressLine ?? ""} className={inputClass} />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-col gap-1 text-sm">
              City
              <input name="city" defaultValue={event.city ?? ""} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              State
              <input
                name="state"
                defaultValue={event.state ?? ""}
                maxLength={2}
                className={`${inputClass} w-16`}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Zip
              <input name="zip" defaultValue={event.zip ?? ""} className={`${inputClass} w-24`} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input name="isAnchor" type="checkbox" defaultChecked={event.isAnchor} />
            Anchor event
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Schedule URL
              <input
                name="scheduleUrl"
                placeholder="https://results.advancedeventsystems.com/event/..."
                defaultValue={event.scheduleUrl ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Platform
              <select
                name="scheduleSource"
                className={selectClass}
                defaultValue={event.scheduleSource ?? ""}
              >
                <option value="">Not set</option>
                {SCHEDULE_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className={`${primaryButtonClass} self-start`}>
            Save
          </button>
        </form>
      </section>

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
