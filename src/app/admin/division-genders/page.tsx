import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { applyDivisionGender, findMislabeledDivisions } from "@/lib/divisionGenderAudit";
import {
  tableClass,
  thClass,
  tdClass,
  stripedTbodyClass,
  primaryButtonClass,
  smallSecondaryButtonClass,
  successBannerClass,
  genderBadgeClass,
  scoringStatusBadgeClass,
} from "@/lib/ui";
import { SubmitButton } from "@/components/SubmitButton";
import type { DivisionGender } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Division Genders" };

const GENDER_LABEL: Record<DivisionGender, string> = { GIRLS: "Girls", BOYS: "Boys", COED: "Coed" };

async function fixDivision(divisionId: string, gender: DivisionGender) {
  "use server";
  await applyDivisionGender(divisionId, gender);
  redirect("/admin/division-genders?fixed=1");
}

/** Applies every suggestion still listed -- re-derived here rather than trusting the
 * rendered list, so a division someone fixed in the meantime is simply skipped. */
async function fixAll() {
  "use server";
  const mismatches = await findMislabeledDivisions();
  for (const m of mismatches) await applyDivisionGender(m.divisionId, m.suggestedGender);
  redirect(`/admin/division-genders?fixed=${mismatches.length}`);
}

export default async function DivisionGendersPage({
  searchParams,
}: {
  searchParams: Promise<{ fixed?: string }>;
}) {
  const { fixed } = await searchParams;
  const mismatches = await findMislabeledDivisions();

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Division Genders</h1>
      <p className="mb-6 max-w-3xl text-sm text-slate-500">
        Divisions whose Girls/Boys label disagrees with the majority of the teams in them —
        usually divisions imported before division gender existed, which all defaulted to
        Girls. A wrong label measures the division&apos;s field strength, scoring suggestion and
        Power-rankings division weight against the wrong girls/boys teams. Team rankings
        themselves follow each team&apos;s own gender and aren&apos;t affected. Fixing a division
        refreshes its scoring suggestion; Power rankings pick it up at the next ratings
        recompute (nightly, or Team Rankings → Recompute ratings).
      </p>

      {fixed && (
        <p className={successBannerClass}>
          {fixed === "1" ? "Division updated." : `${fixed} divisions updated.`} Run a ratings recompute
          to apply it to Power rankings now.
        </p>
      )}

      {mismatches.length === 0 ? (
        <p className="text-sm text-slate-500">No mislabeled divisions found.</p>
      ) : (
        <>
          <form action={fixAll} className="mb-4">
            <SubmitButton className={primaryButtonClass} pendingText="Fixing…">
              Fix all {mismatches.length}
            </SubmitButton>
          </form>
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thClass}>Event</th>
                <th className={thClass}>Division</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Labeled</th>
                <th className={thClass}>Teams (girls / boys)</th>
                <th className={thClass}>Should be</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody className={stripedTbodyClass}>
              {mismatches.map((m) => (
                <tr key={m.divisionId}>
                  <td className={tdClass}>
                    <Link href={`/admin/events/${m.eventId}`} prefetch={false} className="underline">
                      {m.eventName}
                    </Link>
                  </td>
                  <td className={tdClass}>
                    <Link
                      href={`/admin/events/${m.eventId}/divisions/${m.divisionId}`}
                      prefetch={false}
                      className="underline"
                    >
                      {m.divisionName}
                    </Link>
                  </td>
                  <td className={tdClass}>
                    <span className={scoringStatusBadgeClass(m.scoringStatus)}>
                      {m.scoringStatus}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <span className={genderBadgeClass(m.currentGender)}>{GENDER_LABEL[m.currentGender]}</span>
                  </td>
                  <td className={tdClass}>
                    {m.girlsTeams} / {m.boysTeams}
                  </td>
                  <td className={tdClass}>
                    <span className={genderBadgeClass(m.suggestedGender)}>{GENDER_LABEL[m.suggestedGender]}</span>
                  </td>
                  <td className={tdClass}>
                    <form action={fixDivision.bind(null, m.divisionId, m.suggestedGender)}>
                      <SubmitButton className={smallSecondaryButtonClass} pendingText="Fixing…">
                        Set to {GENDER_LABEL[m.suggestedGender]}
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
