// Whether a row still blocks commit, given its CURRENT override state -- not just
// its stored `status`, which is a snapshot from the last Resolve/Re-resolve pass and
// goes stale the moment an admin saves a per-row override without re-resolving.
// Shared by commit.ts (the actual precondition) and the imports UI (live counts/
// filter), so both always agree with each other and with what commit will really do.
export type BlockingRowInput = {
  status: string;
  clubMatchType: string | null;
  overrideClubId: string | null;
  overrideClubName: string | null;
};

export function isRowBlocking(row: BlockingRowInput): boolean {
  // AMBIGUOUS means the club code matched an existing club under a *different*
  // region -- resolvable either by picking that existing club (overrideClubId, "yes
  // that's the same club, the region data was just off") or by naming it as a
  // genuinely different new club (overrideClubName, "no, this is a different club
  // that happens to share a code") -- same two ways out as a plain NEW club.
  if (row.clubMatchType === "AMBIGUOUS" || row.clubMatchType === "NEW") {
    return !row.overrideClubId && !row.overrideClubName;
  }
  // Everything else that reached ERROR (malformed team code, invalid rank,
  // duplicate-in-batch) has no override that can fix it -- only excluding the row
  // does, so trusting stored status here is correct.
  return row.status === "ERROR";
}

export type BlockingReason = "error" | "ambiguousClub" | "unnamedNewClub";

// Buckets are mutually exclusive by construction (AMBIGUOUS checked before NEW
// before generic ERROR), unlike the earlier ad-hoc counts this replaces, which
// double-counted AMBIGUOUS rows (they always also carry status "ERROR").
export function blockingReason(row: BlockingRowInput): BlockingReason | null {
  if (row.clubMatchType === "AMBIGUOUS") {
    return row.overrideClubId || row.overrideClubName ? null : "ambiguousClub";
  }
  if (row.clubMatchType === "NEW") {
    return row.overrideClubId || row.overrideClubName ? null : "unnamedNewClub";
  }
  return row.status === "ERROR" ? "error" : null;
}
