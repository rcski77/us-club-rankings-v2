"use client";

/** Auto-submits its parent (GET) form on change. Mirrors
 * team-rankings/SeasonFilterSelect.tsx -- kept as a separate copy since this page's
 * filter has an "All Seasons" option the rankings page doesn't need. */
export function SeasonFilterSelect({
  seasons,
  defaultValue,
}: {
  seasons: { id: string; label: string }[];
  defaultValue: string;
}) {
  return (
    <select
      name="season"
      defaultValue={defaultValue}
      className="rounded border border-slate-300 px-3 py-2 text-sm"
      onChange={(e) => e.currentTarget.form?.submit()}
    >
      <option value="all">All Seasons</option>
      {seasons.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
