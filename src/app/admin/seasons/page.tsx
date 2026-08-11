import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  inputClass,
  primaryButtonClass,
  smallSecondaryButtonClass,
  errorBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";

export const metadata: Metadata = { title: "Seasons" };

async function createSeason(formData: FormData) {
  "use server";

  const label = String(formData.get("label") ?? "").trim();
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");

  if (!label || !startDate || !endDate) {
    redirect("/admin/seasons?error=invalid");
  }

  const existing = await prisma.season.findUnique({ where: { label } });
  if (existing) {
    redirect("/admin/seasons?error=exists");
  }

  await prisma.season.create({
    data: { label, startDate: new Date(startDate), endDate: new Date(endDate) },
  });

  revalidatePath("/admin/seasons");
}

async function setActiveSeason(seasonId: string) {
  "use server";
  await prisma.$transaction([
    prisma.season.updateMany({ data: { isActive: false } }),
    prisma.season.update({ where: { id: seasonId }, data: { isActive: true } }),
  ]);
  revalidatePath("/admin/seasons");
}

export default async function SeasonsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Seasons</h1>

      {error === "invalid" && (
        <p className={errorBannerClass}>Label, start date, and end date are all required.</p>
      )}
      {error === "exists" && <p className={errorBannerClass}>A season with that label already exists.</p>}

      <table className={`${tableClass} mb-8`}>
        <thead>
          <tr>
            <th className={thClass}>Label</th>
            <th className={thClass}>Start</th>
            <th className={thClass}>End</th>
            <th className={thClass}>Active</th>
            <th className={thClass}></th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((s) => (
            <tr key={s.id}>
              <td className={tdClass}>{s.label}</td>
              <td className={tdClass}>{s.startDate.toISOString().slice(0, 10)}</td>
              <td className={tdClass}>{s.endDate.toISOString().slice(0, 10)}</td>
              <td className={tdClass}>{s.isActive ? "Active" : ""}</td>
              <td className={tdClass}>
                {!s.isActive && (
                  <form
                    action={async () => {
                      "use server";
                      await setActiveSeason(s.id);
                    }}
                  >
                    <button type="submit" className={smallSecondaryButtonClass}>
                      Set active
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {seasons.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={5}>
                No seasons yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-medium">New season</h2>
      <form action={createSeason} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Label
          <input name="label" placeholder="2025-2026" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Start date
          <input name="startDate" type="date" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          End date
          <input name="endDate" type="date" required className={inputClass} />
        </label>
        <button type="submit" className={primaryButtonClass}>
          Create
        </button>
      </form>
    </div>
  );
}
