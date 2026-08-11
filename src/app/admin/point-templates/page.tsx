import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  inputClass,
  primaryButtonClass,
  errorBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";

export const metadata: Metadata = { title: "Point Templates" };

async function createTemplate(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const isAnchorTemplate = formData.get("isAnchorTemplate") === "on";

  if (!name) {
    redirect("/admin/point-templates?error=invalid");
  }

  const existing = await prisma.pointTemplate.findUnique({ where: { name } });
  if (existing) {
    redirect("/admin/point-templates?error=exists");
  }

  const template = await prisma.pointTemplate.create({
    data: { name, description, isAnchorTemplate, maxPoints: 0 },
  });

  redirect(`/admin/point-templates/${template.id}`);
}

export default async function PointTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const templates = await prisma.pointTemplate.findMany({
    include: { _count: { select: { bands: true } } },
    orderBy: { maxPoints: "desc" },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Point Templates</h1>

      {error === "invalid" && <p className={errorBannerClass}>Name is required.</p>}
      {error === "exists" && (
        <p className={errorBannerClass}>A template with that name already exists.</p>
      )}

      <table className={`${tableClass} mb-8`}>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Max points</th>
            <th className={thClass}>Bands</th>
            <th className={thClass}>Anchor</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id}>
              <td className={tdClass}>
                <Link href={`/admin/point-templates/${t.id}`} prefetch={false} className="text-slate-900 underline">
                  {t.name}
                </Link>
              </td>
              <td className={tdClass}>{t.maxPoints}</td>
              <td className={tdClass}>{t._count.bands}</td>
              <td className={tdClass}>{t.isAnchorTemplate ? "Anchor" : ""}</td>
            </tr>
          ))}
          {templates.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={4}>
                No point templates yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-medium">New template</h2>
      <form action={createTemplate} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input name="name" placeholder="245 max (USAV Nationals tier)" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Description
          <input name="description" className={`${inputClass} w-64`} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="isAnchorTemplate" type="checkbox" />
          Anchor tier
        </label>
        <button type="submit" className={primaryButtonClass}>
          Create template
        </button>
      </form>
    </div>
  );
}
