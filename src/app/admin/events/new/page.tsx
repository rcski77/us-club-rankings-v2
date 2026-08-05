import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { uniqueSlug } from "@/lib/slug";
import { inputClass, selectClass, primaryButtonClass, errorBannerClass } from "@/lib/ui";

async function createEvent(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const seasonId = String(formData.get("seasonId") ?? "");
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const addressLine = String(formData.get("addressLine") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const state = String(formData.get("state") ?? "").trim() || null;
  const zip = String(formData.get("zip") ?? "").trim() || null;
  const isAnchor = formData.get("isAnchor") === "on";
  const isPriority = formData.get("isPriority") === "on";

  if (!name || !seasonId || !startDate || !endDate) {
    redirect("/admin/events/new?error=invalid");
  }

  const slug = await uniqueSlug(name, async (candidate) => {
    const existing = await prisma.event.findUnique({ where: { slug: candidate } });
    return existing !== null;
  });

  const event = await prisma.event.create({
    data: {
      name,
      slug,
      seasonId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      addressLine,
      city,
      state,
      zip,
      isAnchor,
      isPriority,
    },
  });

  redirect(`/admin/events/${event.id}`);
}

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold">New event</h1>

      {error === "invalid" && (
        <p className={errorBannerClass}>Name, season, start date, and end date are required.</p>
      )}
      {seasons.length === 0 && (
        <p className={errorBannerClass}>Create a season first (Admin → Seasons).</p>
      )}

      {seasons.length > 0 && (
        <form action={createEvent} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input name="name" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Season
            <select name="seasonId" className={selectClass} defaultValue={activeSeason?.id}>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Start date
              <input name="startDate" type="date" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              End date
              <input name="endDate" type="date" required className={inputClass} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Address
            <input name="addressLine" className={inputClass} />
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
          <label className="flex items-center gap-2 text-sm">
            <input name="isAnchor" type="checkbox" />
            Anchor event (USAV Nationals / Triple Crown NIT)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="isPriority" type="checkbox" />
            Priority event (import first)
          </label>
          <button type="submit" className={`${primaryButtonClass} self-start`}>
            Create event
          </button>
        </form>
      )}
    </div>
  );
}
