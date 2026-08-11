import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireSuperAdmin } from "@/lib/authz";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  inputClass,
  selectClass,
  primaryButtonClass,
  secondaryButtonClass,
  smallSecondaryButtonClass,
  errorBannerClass,
  successBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";
import { uniqueSlug } from "@/lib/slug";
import DeleteEventButton from "./DeleteEventButton";
import type { DivisionTierLabel, ImportSource } from "@/generated/prisma/enums";

const IMPORT_TYPE_LABELS: Record<string, string> = {
  TEAM_FINISHES: "Team Finishes",
  MATCH_RESULTS: "Match Results",
  DIVISIONS: "Divisions",
};

const IMPORT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  RESOLVED: "Resolved",
  COMMITTED: "Committed",
  FAILED: "Failed",
};

// Best-to-worst division strength, USAV and AAU tiers merged into one order
// (see docs/domain-notes.md) since both share this one dropdown/enum.
const TIER_LABELS: DivisionTierLabel[] = [
  "OPEN",
  "PREMIER",
  "USA",
  "LIBERTY",
  "AMERICAN",
  "CLUB",
  "FREEDOM",
  "CLASSIC",
  "PATRIOT",
];

const SCHEDULE_SOURCES: ImportSource[] = ["AES", "SPORTWRENCH", "TM2", "VBSCHEDULE"];

async function updateEvent(eventId: string, formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const startDateRaw = String(formData.get("startDate") ?? "");
  const endDateRaw = String(formData.get("endDate") ?? "");
  const isAnchor = formData.get("isAnchor") === "on";
  const isPriority = formData.get("isPriority") === "on";
  const addressLine = String(formData.get("addressLine") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const state = String(formData.get("state") ?? "").trim() || null;
  const zip = String(formData.get("zip") ?? "").trim() || null;

  const startDate = startDateRaw ? new Date(startDateRaw) : null;
  const endDate = endDateRaw ? new Date(endDateRaw) : null;

  if (!name || !startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    redirect(`/admin/events/${eventId}?error=invalid`);
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { name, startDate, endDate, isAnchor, isPriority, addressLine, city, state, zip },
  });

  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/events");
  redirect(`/admin/events/${eventId}?success=1`);
}

async function addEventSchedule(eventId: string, formData: FormData) {
  "use server";

  const url = String(formData.get("url") ?? "").trim();
  const sourceRaw = String(formData.get("source") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || null;
  const source = SCHEDULE_SOURCES.includes(sourceRaw as ImportSource) ? (sourceRaw as ImportSource) : null;

  if (!url || !source) {
    redirect(`/admin/events/${eventId}?error=invalid-schedule`);
  }

  await prisma.eventSchedule.create({ data: { eventId, url, source: source!, label } });

  revalidatePath(`/admin/events/${eventId}`);
  redirect(`/admin/events/${eventId}`);
}

async function deleteEventSchedule(eventId: string, scheduleId: string) {
  "use server";

  await requireSuperAdmin(`/admin/events/${eventId}`);
  await prisma.eventSchedule.delete({ where: { id: scheduleId } });

  revalidatePath(`/admin/events/${eventId}`);
  redirect(`/admin/events/${eventId}`);
}

// Starts one import batch against a single schedule link (or none, for a
// manual-CSV-only import) -- eventScheduleId "" means no schedule.
async function startImportForSchedule(eventId: string, formData: FormData) {
  "use server";

  const session = await auth();
  const importTypeRaw = String(formData.get("importType") ?? "TEAM_FINISHES");
  const importType = importTypeRaw === "MATCH_RESULTS" ? "MATCH_RESULTS" : "TEAM_FINISHES";
  const eventScheduleId = String(formData.get("eventScheduleId") ?? "").trim() || null;

  const schedule = eventScheduleId
    ? await prisma.eventSchedule.findUnique({ where: { id: eventScheduleId } })
    : null;

  const batch = await prisma.importBatch.create({
    data: {
      eventId,
      source: schedule?.source ?? "AES",
      importType,
      status: "DRAFT",
      scheduleUrl: schedule?.url ?? null,
      scheduleSource: schedule?.source ?? null,
      createdById: session?.user?.id ?? null,
    },
  });

  redirect(`/admin/imports/${batch.id}`);
}

// Starts one import batch per schedule link on this event, in one click -- this is
// what lets a weekend split across several AES/Sportwrench schedule pages get
// combined into a single event without starting each import by hand. Sequential,
// not Promise.all -- see docs/dev-environment.md.
async function startImportForAllSchedules(eventId: string, formData: FormData) {
  "use server";

  const session = await auth();
  const importTypeRaw = String(formData.get("importType") ?? "TEAM_FINISHES");
  const importType = importTypeRaw === "MATCH_RESULTS" ? "MATCH_RESULTS" : "TEAM_FINISHES";

  const schedules = await prisma.eventSchedule.findMany({ where: { eventId } });
  for (const schedule of schedules) {
    await prisma.importBatch.create({
      data: {
        eventId,
        source: schedule.source,
        importType,
        status: "DRAFT",
        scheduleUrl: schedule.url,
        scheduleSource: schedule.source,
        createdById: session?.user?.id ?? null,
      },
    });
  }

  revalidatePath(`/admin/events/${eventId}`);
  redirect(`/admin/events/${eventId}?success=imports-started`);
}

// Cleans up the two relations Prisma doesn't cascade automatically (AuditFlag and
// Match both point at ImportBatch without onDelete: Cascade -- see prisma/CLAUDE.md
// on why event.delete() alone throws an FK violation once an event has real import
// data) before deleting the event itself, which cascades everything else
// (Division -> TeamFinish/DivisionPointBand/DivisionScoringSnapshot, EventSchedule,
// Match, remaining ImportBatch rows).
async function deleteEvent(eventId: string) {
  "use server";

  await requireSuperAdmin(`/admin/events/${eventId}`);
  await prisma.$transaction(async (tx) => {
    const batches = await tx.importBatch.findMany({ where: { eventId }, select: { id: true } });
    const divisions = await tx.division.findMany({ where: { eventId }, select: { id: true } });

    await tx.auditFlag.deleteMany({
      where: {
        OR: [
          { importBatchId: { in: batches.map((b) => b.id) } },
          { divisionId: { in: divisions.map((d) => d.id) } },
        ],
      },
    });
    await tx.match.deleteMany({ where: { eventId } });
    await tx.importBatch.deleteMany({ where: { eventId } });
    await tx.event.delete({ where: { id: eventId } });
  });

  revalidatePath("/admin/events");
  redirect("/admin/events?success=event-deleted");
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
  const session = await auth();
  const isSuperAdmin = session?.user.role === "SUPER_ADMIN";

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      season: true,
      schedules: { orderBy: { createdAt: "asc" } },
      divisions: {
        orderBy: [{ ageGroup: "desc" }, { name: "asc" }],
        include: {
          _count: { select: { finishes: true } },
          pointBands: { orderBy: { fromRank: "asc" }, take: 1 },
        },
      },
      importBatches: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!event) notFound();

  const createDivisionWithEvent = createDivision.bind(null, eventId);
  const updateEventWithId = updateEvent.bind(null, eventId);
  const addEventScheduleWithId = addEventSchedule.bind(null, eventId);
  const startImportForAllSchedulesWithId = startImportForAllSchedules.bind(null, eventId);
  const startImportForScheduleWithId = startImportForSchedule.bind(null, eventId);
  const deleteEventWithId = deleteEvent.bind(null, eventId);
  const finishCount = event.divisions.reduce((sum, d) => sum + d._count.finishes, 0);

  return (
    <div>
      <Breadcrumbs items={[{ label: "Events", href: "/admin/events" }, { label: event.name }]} />
      <h1 className="mb-1 text-2xl font-semibold">{event.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {event.season.label} · {event.startDate.toISOString().slice(0, 10)} –{" "}
        {event.endDate.toISOString().slice(0, 10)}
        {event.isAnchor && " · Anchor event"}
        {event.isPriority && " · Priority"}
      </p>

      {error === "invalid" && (
        <p className={errorBannerClass}>Name and valid start/end dates are required.</p>
      )}
      {error === "invalid-schedule" && (
        <p className={errorBannerClass}>A schedule URL and platform are both required.</p>
      )}
      {error === "forbidden" && (
        <p className={errorBannerClass}>Only super admins can delete records.</p>
      )}
      {success === "1" && <p className={successBannerClass}>Event saved.</p>}
      {success === "imports-started" && (
        <p className={successBannerClass}>Started one import per schedule link below.</p>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Schedule links</h2>
        <p className="mb-2 text-xs text-slate-500">
          One row per results/schedule page this event&apos;s divisions are spread
          across. Most events have exactly one -- add more here when one weekend is
          split across several AES/Sportwrench schedule pages (e.g. separate pages per
          age group), then start an import for each below to combine them all into
          this one event.
        </p>
        {event.schedules.length > 0 && (
          <table className={`${tableClass} mb-3`}>
            <thead>
              <tr>
                <th className={thClass}>Label</th>
                <th className={thClass}>Platform</th>
                <th className={thClass}>URL</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody>
              {event.schedules.map((s) => {
                const deleteWithIds = deleteEventSchedule.bind(null, eventId, s.id);
                return (
                  <tr key={s.id}>
                    <td className={tdClass}>{s.label ?? "—"}</td>
                    <td className={tdClass}>{s.source}</td>
                    <td className={`${tdClass} max-w-[20rem] truncate text-xs text-slate-500`}>{s.url}</td>
                    <td className={tdClass}>
                      {isSuperAdmin && (
                        <form action={deleteWithIds}>
                          <button type="submit" className={smallSecondaryButtonClass}>
                            Remove
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <form action={addEventScheduleWithId} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Schedule URL
            <input
              name="url"
              placeholder="https://results.advancedeventsystems.com/event/..."
              required
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Platform
            <select name="source" className={selectClass} defaultValue="AES" required>
              {SCHEDULE_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Label (optional)
            <input name="label" placeholder="15s/16s" className={`${inputClass} w-32`} />
          </label>
          <button type="submit" className={secondaryButtonClass}>
            Add schedule link
          </button>
        </form>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Imports</h2>
        {event.importBatches.length > 0 && (
          <table className={`${tableClass} mb-3`}>
            <thead>
              <tr>
                <th className={thClass}>Type</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Schedule</th>
                <th className={thClass}>Created</th>
              </tr>
            </thead>
            <tbody>
              {event.importBatches.map((b) => (
                <tr key={b.id}>
                  <td className={tdClass}>
                    <Link href={`/admin/imports/${b.id}`} prefetch={false} className="text-slate-900 underline">
                      {IMPORT_TYPE_LABELS[b.importType] ?? b.importType}
                    </Link>
                  </td>
                  <td className={tdClass}>{IMPORT_STATUS_LABELS[b.status] ?? b.status}</td>
                  <td className={`${tdClass} max-w-[16rem] truncate text-xs text-slate-500`}>
                    {b.scheduleUrl ?? "—"}
                  </td>
                  <td className={tdClass}>{b.createdAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {event.schedules.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-3 border-b border-slate-200 pb-4">
            <form action={startImportForAllSchedulesWithId}>
              <input type="hidden" name="importType" value="TEAM_FINISHES" />
              <button type="submit" className={primaryButtonClass}>
                Start Team Finishes import for all {event.schedules.length} schedules
              </button>
            </form>
            <form action={startImportForAllSchedulesWithId}>
              <input type="hidden" name="importType" value="MATCH_RESULTS" />
              <button type="submit" className={secondaryButtonClass}>
                Start Match Results import for all {event.schedules.length} schedules
              </button>
            </form>
          </div>
        )}

        <p className="mb-2 text-sm font-medium">Start a single import</p>
        <div className="mb-3 flex flex-wrap gap-3">
          <form action={startImportForScheduleWithId} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="importType" value="TEAM_FINISHES" />
            <label className="flex flex-col gap-1 text-sm">
              Schedule
              <select name="eventScheduleId" className={selectClass} defaultValue="">
                <option value="">No schedule (manual CSV upload)</option>
                {event.schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label ? `${s.label} — ` : ""}
                    {s.source}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={primaryButtonClass}>
              Start Team Finishes import
            </button>
          </form>
          <form action={startImportForScheduleWithId} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="importType" value="MATCH_RESULTS" />
            <label className="flex flex-col gap-1 text-sm">
              Schedule
              <select name="eventScheduleId" className={selectClass} defaultValue="">
                <option value="">No schedule (manual CSV upload)</option>
                {event.schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label ? `${s.label} — ` : ""}
                    {s.source}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={secondaryButtonClass}>
              Start Match Results import
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Match Results requires Team Finishes to already be imported (it resolves
          teams/divisions from that data, not from scratch).
        </p>
      </section>

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
          <label className="flex items-center gap-2 text-sm">
            <input name="isPriority" type="checkbox" defaultChecked={event.isPriority} />
            Priority event (import first)
          </label>
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
            <th className={thClass}>Max points</th>
            <th className={thClass}>Finishes</th>
          </tr>
        </thead>
        <tbody>
          {event.divisions.map((d) => (
            <tr key={d.id}>
              <td className={tdClass}>
                <Link
                  href={`/admin/events/${event.id}/divisions/${d.id}`}
                  prefetch={false}
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
              <td className={tdClass}>{d.pointBands[0]?.points ?? "—"}</td>
              <td className={tdClass}>{d._count.finishes}</td>
            </tr>
          ))}
          {event.divisions.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={6}>
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

      {isSuperAdmin && (
        <section className="mt-10 border-t border-slate-200 pt-6">
          <h2 className="mb-2 text-lg font-medium text-red-700">Danger zone</h2>
          <p className="mb-3 text-xs text-slate-500">
            Permanently deletes this event and everything under it: divisions, team
            finishes, point bands, schedule links, and import batches. Use this to
            clean up a duplicate or mistakenly-created event. This cannot be undone.
          </p>
          <DeleteEventButton
            action={deleteEventWithId}
            eventName={event.name}
            divisionCount={event.divisions.length}
            finishCount={finishCount}
          />
        </section>
      )}
    </div>
  );
}
