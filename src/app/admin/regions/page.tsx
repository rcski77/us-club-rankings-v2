import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import {
  inputClass,
  selectClass,
  secondaryButtonClass,
  errorBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";
import type { UsavZone } from "@/generated/prisma/enums";

const ZONE_ORDER: UsavZone[] = ["ATLANTIC", "BORDER", "CENTRAL", "PACIFIC"];
const ZONE_LABEL: Record<UsavZone, string> = {
  ATLANTIC: "Atlantic Zone",
  BORDER: "Border Zone",
  CENTRAL: "Central Zone",
  PACIFIC: "Pacific Zone",
};

async function createRegion(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const zoneRaw = String(formData.get("zone") ?? "");
  const zone = (ZONE_ORDER as string[]).includes(zoneRaw) ? (zoneRaw as UsavZone) : null;

  if (!name || code.length < 2) {
    redirect("/admin/regions?error=invalid");
  }

  const existing = await prisma.region.findUnique({ where: { code } });
  if (existing) {
    redirect("/admin/regions?error=exists");
  }

  await prisma.region.create({ data: { name, code, zone } });
  redirect("/admin/regions");
}

export default async function RegionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const regions = await prisma.region.findMany({
    include: { _count: { select: { clubs: true } } },
    orderBy: { code: "asc" },
  });

  const byZone = new Map<UsavZone | "none", typeof regions>();
  for (const region of regions) {
    const key = region.zone ?? "none";
    const list = byZone.get(key) ?? [];
    list.push(region);
    byZone.set(key, list);
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Regions</h1>

      {error === "invalid" && (
        <p className={errorBannerClass}>Name and a region code (2+ letters) are required.</p>
      )}
      {error === "exists" && (
        <p className={errorBannerClass}>A region with that code already exists.</p>
      )}

      {regions.length === 0 && <p className="mb-6 text-sm text-slate-500">No regions yet.</p>}

      {[...ZONE_ORDER, "none" as const].map((zoneKey) => {
        const zoneRegions = byZone.get(zoneKey);
        if (!zoneRegions || zoneRegions.length === 0) return null;

        return (
          <section key={zoneKey} className="mb-6">
            <h2 className="mb-2 text-lg font-medium">
              {zoneKey === "none" ? "No zone assigned" : ZONE_LABEL[zoneKey]}
            </h2>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>Code</th>
                  <th className={thClass}>Name</th>
                  <th className={thClass}>Clubs</th>
                </tr>
              </thead>
              <tbody>
                {zoneRegions.map((r) => (
                  <tr key={r.id}>
                    <td className={`${tdClass} font-mono`}>{r.code}</td>
                    <td className={tdClass}>{r.name}</td>
                    <td className={tdClass}>{r._count.clubs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      <h2 className="mb-2 text-lg font-medium">New region</h2>
      <form action={createRegion} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input name="name" placeholder="North Texas" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Code
          <input name="code" placeholder="NT" className={`${inputClass} w-24 uppercase`} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Zone
          <select name="zone" className={selectClass} defaultValue="">
            <option value="">(none)</option>
            {ZONE_ORDER.map((z) => (
              <option key={z} value={z}>
                {ZONE_LABEL[z]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={secondaryButtonClass}>
          Create region
        </button>
      </form>
    </div>
  );
}
