"use client";

import { selectClass } from "@/lib/ui";

export function RegionFilterSelect({
  regions,
  defaultValue,
}: {
  regions: { id: string; code: string; name: string }[];
  defaultValue: string;
}) {
  return (
    <select
      name="regionId"
      defaultValue={defaultValue}
      className={selectClass}
      onChange={(e) => e.currentTarget.form?.submit()}
    >
      <option value="">All regions</option>
      {regions.map((r) => (
        <option key={r.id} value={r.id}>
          {r.code} — {r.name}
        </option>
      ))}
    </select>
  );
}
