import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  selectClass,
  primaryButtonClass,
  smallSecondaryButtonClass,
  errorBannerClass,
  successBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";
import { SubmitButton } from "@/components/SubmitButton";

async function startImportBatch(formData: FormData) {
  "use server";

  const session = await auth();
  const eventId = String(formData.get("eventId") ?? "");
  const importTypeRaw = String(formData.get("importType") ?? "TEAM_FINISHES");
  const importType = importTypeRaw === "MATCH_RESULTS" ? "MATCH_RESULTS" : "TEAM_FINISHES";
  if (!eventId) redirect("/admin/imports?error=invalid");

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  // Batch source follows the event's own configured platform (set on the event's
  // page) rather than always being AES -- otherwise a Sportwrench event's batches
  // would display and behave (via the Fetch button's scheduleSource check) as
  // Sportwrench while the batch's own `source` column still claimed AES.
  const batch = await prisma.importBatch.create({
    data: {
      eventId,
      source: event?.scheduleSource ?? "AES",
      importType,
      status: "DRAFT",
      createdById: session?.user?.id ?? null,
    },
  });

  redirect(`/admin/imports/${batch.id}`);
}

async function deleteImportBatch(batchId: string) {
  "use server";

  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.status === "COMMITTED") {
    redirect("/admin/imports?error=delete-committed");
  }
  await prisma.importBatch.delete({ where: { id: batchId } });
  redirect("/admin/imports?success=deleted");
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  RESOLVED: "Resolved",
  COMMITTED: "Committed",
  FAILED: "Failed",
};

const IMPORT_TYPE_LABELS: Record<string, string> = {
  TEAM_FINISHES: "Team Finishes",
  MATCH_RESULTS: "Match Results",
  DIVISIONS: "Divisions",
};

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;

  // Sequential, not Promise.all -- see docs/dev-environment.md.
  const batches = await prisma.importBatch.findMany({
    include: { event: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const events = await prisma.event.findMany({
    include: { season: true },
    orderBy: [{ startDate: "desc" }],
    take: 200,
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Imports</h1>

      {error === "invalid" && <p className={errorBannerClass}>Select an event to import into.</p>}
      {error === "delete-committed" && (
        <p className={errorBannerClass}>Committed imports can&apos;t be deleted.</p>
      )}
      {success === "deleted" && <p className={successBannerClass}>Import deleted.</p>}

      <table className={`${tableClass} mb-8`}>
        <thead>
          <tr>
            <th className={thClass}>Event</th>
            <th className={thClass}>Source</th>
            <th className={thClass}>Type</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Summary</th>
            <th className={thClass}>Created</th>
            <th className={thClass}></th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => {
            const deleteWithId = deleteImportBatch.bind(null, b.id);
            const summaryText =
              b.importType === "MATCH_RESULTS"
                ? (() => {
                    const s = b.summaryJson as
                      | { created?: number; updated?: number; skipped?: number }
                      | null;
                    return s ? `${s.created ?? 0} created · ${s.updated ?? 0} updated · ${s.skipped ?? 0} skipped` : "";
                  })()
                : (() => {
                    const s = b.summaryJson as { ok?: number; warning?: number; error?: number } | null;
                    return s ? `${s.ok ?? 0} ok · ${s.warning ?? 0} warning · ${s.error ?? 0} error` : "";
                  })();
            return (
              <tr key={b.id}>
                <td className={tdClass}>
                  <Link href={`/admin/imports/${b.id}`} className="text-slate-900 underline">
                    {b.event.name}
                  </Link>
                </td>
                <td className={tdClass}>{b.source}</td>
                <td className={tdClass}>{IMPORT_TYPE_LABELS[b.importType] ?? b.importType}</td>
                <td className={tdClass}>{STATUS_LABELS[b.status] ?? b.status}</td>
                <td className={tdClass}>{summaryText}</td>
                <td className={tdClass}>{b.createdAt.toISOString().slice(0, 10)}</td>
                <td className={tdClass}>
                  {b.status !== "COMMITTED" && (
                    <form action={deleteWithId}>
                      <SubmitButton className={smallSecondaryButtonClass} pendingText="Deleting…">
                        Delete
                      </SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
          {batches.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={7}>
                No imports yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-medium">Start import</h2>
      <p className="mb-2 text-xs text-slate-500">
        Source is taken from the event&apos;s own schedule platform (set on the
        event&apos;s page) — AES and Sportwrench have working Fetch buttons, other
        platforms don&apos;t yet. Match Results requires the event&apos;s Team
        Finishes to already be imported (it resolves teams/divisions from that data,
        not from scratch).
      </p>
      <form action={startImportBatch} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Event
          <select name="eventId" className={selectClass} defaultValue="" required>
            <option value="" disabled>
              Select an event…
            </option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.season.label} — {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select name="importType" className={selectClass} defaultValue="TEAM_FINISHES">
            <option value="TEAM_FINISHES">Team Finishes</option>
            <option value="MATCH_RESULTS">Match Results</option>
          </select>
        </label>
        <SubmitButton className={primaryButtonClass} pendingText="Starting…">
          Start import
        </SubmitButton>
      </form>
    </div>
  );
}
