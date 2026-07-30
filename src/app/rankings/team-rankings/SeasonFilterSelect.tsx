"use client";

import { selectClass } from "@/lib/ui";

/** Auto-submits its parent (GET) form on change, carrying the view/ageGroup hidden fields along. */
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
      className={selectClass}
      onChange={(e) => e.currentTarget.form?.submit()}
    >
      {seasons.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
