import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireSuperAdmin } from "@/lib/authz";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { refreshMaxPoints } from "@/lib/pointTemplates";
import {
  inputClass,
  primaryButtonClass,
  smallSecondaryButtonClass,
  errorBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ templateId: string }>;
}): Promise<Metadata> {
  const { templateId } = await params;
  const template = await prisma.pointTemplate.findUnique({ where: { id: templateId }, select: { name: true } });
  return { title: template?.name ?? "Point Template" };
}

async function addBand(templateId: string, formData: FormData) {
  "use server";

  const fromRank = Number(formData.get("fromRank"));
  const toRank = Number(formData.get("toRank"));
  const points = Number(formData.get("points"));

  if (!fromRank || points === undefined || Number.isNaN(toRank) || Number.isNaN(points)) {
    redirect(`/admin/point-templates/${templateId}?error=invalid`);
  }

  const existing = await prisma.pointTemplateBand.findUnique({
    where: { pointTemplateId_fromRank: { pointTemplateId: templateId, fromRank } },
  });
  if (existing) {
    redirect(`/admin/point-templates/${templateId}?error=duplicate`);
  }

  await prisma.pointTemplateBand.create({
    data: { pointTemplateId: templateId, fromRank, toRank, points },
  });
  await refreshMaxPoints(templateId);

  redirect(`/admin/point-templates/${templateId}`);
}

async function removeBand(templateId: string, bandId: string) {
  "use server";
  await requireSuperAdmin(`/admin/point-templates/${templateId}`);
  await prisma.pointTemplateBand.delete({ where: { id: bandId } });
  await refreshMaxPoints(templateId);
  redirect(`/admin/point-templates/${templateId}`);
}

async function toggleAnchor(templateId: string, isAnchorTemplate: boolean) {
  "use server";
  await prisma.pointTemplate.update({
    where: { id: templateId },
    data: { isAnchorTemplate: !isAnchorTemplate },
  });
  redirect(`/admin/point-templates/${templateId}`);
}

export default async function PointTemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { templateId } = await params;
  const { error } = await searchParams;
  const session = await auth();
  const isSuperAdmin = session?.user.role === "SUPER_ADMIN";

  const template = await prisma.pointTemplate.findUnique({
    where: { id: templateId },
    include: { bands: { orderBy: { fromRank: "asc" } } },
  });
  if (!template) notFound();

  const addBandWithTemplate = addBand.bind(null, templateId);

  return (
    <div className="max-w-xl">
      <Breadcrumbs items={[{ label: "Point Templates", href: "/admin/point-templates" }, { label: template.name }]} />
      <h1 className="mb-1 text-2xl font-semibold">{template.name}</h1>
      <p className="mb-2 text-sm text-slate-500">
        Max points: {template.maxPoints}
        {template.isAnchorTemplate && " · Anchor tier"}
      </p>

      <form
        action={async () => {
          "use server";
          await toggleAnchor(templateId, template.isAnchorTemplate);
        }}
        className="mb-6"
      >
        <button type="submit" className={smallSecondaryButtonClass}>
          {template.isAnchorTemplate ? "Remove anchor tier" : "Mark as anchor tier"}
        </button>
      </form>

      {error === "invalid" && (
        <p className={errorBannerClass}>From rank and points are required (to rank 0 = open-ended).</p>
      )}
      {error === "duplicate" && (
        <p className={errorBannerClass}>A band already starts at that rank.</p>
      )}
      {error === "forbidden" && (
        <p className={errorBannerClass}>Only super admins can delete records.</p>
      )}

      <table className={`${tableClass} mb-6`}>
        <thead>
          <tr>
            <th className={thClass}>From</th>
            <th className={thClass}>To</th>
            <th className={thClass}>Points</th>
            <th className={thClass}></th>
          </tr>
        </thead>
        <tbody>
          {template.bands.map((b) => (
            <tr key={b.id}>
              <td className={tdClass}>{b.fromRank}</td>
              <td className={tdClass}>{b.toRank === 0 ? "+" : b.toRank}</td>
              <td className={tdClass}>{b.points}</td>
              <td className={tdClass}>
                {isSuperAdmin && (
                  <form
                    action={async () => {
                      "use server";
                      await removeBand(templateId, b.id);
                    }}
                  >
                    <button type="submit" className={smallSecondaryButtonClass}>
                      Remove
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {template.bands.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={4}>
                No bands yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-medium">Add band</h2>
      <form action={addBandWithTemplate} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          From rank
          <input name="fromRank" type="number" min={1} required className={`${inputClass} w-24`} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To rank (0 = +)
          <input name="toRank" type="number" min={0} required className={`${inputClass} w-24`} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Points
          <input name="points" type="number" min={0} required className={`${inputClass} w-24`} />
        </label>
        <button type="submit" className={primaryButtonClass}>
          Add band
        </button>
      </form>
    </div>
  );
}
