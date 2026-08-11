import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { uniqueSlug } from "@/lib/slug";
import { RegionFilterSelect } from "./RegionFilterSelect";
import {
  inputClass,
  selectClass,
  primaryButtonClass,
  errorBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";

export const metadata: Metadata = { title: "Clubs" };

async function createClub(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const regionId = String(formData.get("regionId") ?? "") || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const state = String(formData.get("state") ?? "").trim() || null;
  const zip = String(formData.get("zip") ?? "").trim() || null;

  if (!name) {
    redirect("/admin/clubs?error=invalid");
  }

  const slug = await uniqueSlug(name, async (candidate) => {
    const existing = await prisma.club.findUnique({ where: { slug: candidate } });
    return existing !== null;
  });

  await prisma.club.create({ data: { name, slug, regionId, city, state, zip } });
  revalidatePath("/admin/clubs");
}

export default async function ClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string; regionId?: string }>;
}) {
  const { error, q, regionId } = await searchParams;
  // clubs and regions don't depend on each other's results.
  const [clubs, regions] = await Promise.all([
    prisma.club.findMany({
      where: {
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { externalCode: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(regionId ? { regionId } : {}),
      },
      include: { region: true, mergedInto: true, _count: { select: { teams: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.region.findMany({ orderBy: { code: "asc" } }),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Clubs</h1>

      {error === "invalid" && <p className={errorBannerClass}>Club name is required.</p>}

      <form action="/admin/clubs" method="get" className="mb-4 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name or code…"
          className={`${inputClass} max-w-sm`}
        />
        <RegionFilterSelect regions={regions} defaultValue={regionId ?? ""} />
        <button type="submit" className={primaryButtonClass}>
          Search
        </button>
        {(q || regionId) && (
          <Link href="/admin/clubs" className="self-center text-sm text-slate-500 underline">
            Clear
          </Link>
        )}
      </form>

      <table className={`${tableClass} mb-8`}>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Region</th>
            <th className={thClass}>City/State</th>
            <th className={thClass}>External code</th>
            <th className={thClass}>Teams</th>
          </tr>
        </thead>
        <tbody>
          {clubs.map((c) => (
            <tr key={c.id}>
              <td className={tdClass}>
                <Link href={`/admin/clubs/${c.id}`} prefetch={false} className="text-slate-900 underline">
                  {c.name}
                </Link>
                {c.mergedInto && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    merged → {c.mergedInto.name}
                  </span>
                )}
              </td>
              <td className={tdClass}>{c.region?.code ?? ""}</td>
              <td className={tdClass}>
                {[c.city, c.state].filter(Boolean).join(", ")}
              </td>
              <td className={tdClass}>{c.externalCode ?? ""}</td>
              <td className={tdClass}>{c._count.teams}</td>
            </tr>
          ))}
          {clubs.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={5}>
                {q || regionId ? "No clubs match your search." : "No clubs yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-medium">New club</h2>
      <form action={createClub} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input name="name" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Region
          <select name="regionId" className={selectClass} defaultValue="">
            <option value="">(none)</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} — {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-3">
          <label className="flex flex-col gap-1 text-sm">
            City
            <input name="city" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            State
            <input name="state" maxLength={2} className={`${inputClass} w-16`} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Zip
            <input name="zip" className={`${inputClass} w-24`} />
          </label>
        </div>
        <button type="submit" className={primaryButtonClass}>
          Create club
        </button>
      </form>
    </div>
  );
}
