/**
 * True if a TeamSeason's externalTeamCode marks the team as boys. AES codes lead with
 * a single gender character -- "g" for girls, "b" for boys (see aesTeamCode.ts) -- so
 * this is a simple prefix check, not a full decode. Only positive evidence excludes a
 * team: a missing/unparseable code (a manually-created team, or a non-AES import) is
 * treated as NOT boys, since girls rankings are the current focus (docs/plan.md) but
 * boys teams are only known to exist via this one signal -- there's nothing else to
 * exclude on. Boys ranking support is planned but not built (docs/plan.md).
 */
export function isBoysTeamCode(externalTeamCode: string | null | undefined): boolean {
  return (externalTeamCode ?? "").trim().toLowerCase().startsWith("b");
}
