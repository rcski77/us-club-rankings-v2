"use client";

import { useRouter } from "next/navigation";
import { selectClass } from "@/lib/ui";

/** Season switcher for the [seasonId]/[ageGroup] route -- season lives in the path
 * here, not a query param, so switching means navigating to a new URL rather than
 * submitting a GET form in place (see SeasonFilterSelect in team-rankings, which
 * that pattern does work for). */
export function SeasonPathSelect({
  seasons,
  defaultValue,
  ageGroup,
}: {
  seasons: { id: string; label: string }[];
  defaultValue: string;
  ageGroup: number;
}) {
  const router = useRouter();
  return (
    <select
      defaultValue={defaultValue}
      className={selectClass}
      onChange={(e) => router.push(`/admin/analysis/${e.currentTarget.value}/${ageGroup}`)}
    >
      {seasons.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
