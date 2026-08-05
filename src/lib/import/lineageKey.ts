// Mirrors Team.lineageKey's doc comment: derived from (gender, club externalCode+region,
// teamNumber) -- stable across seasons even as the age-group digit in the source
// code changes. Single source of truth so resolve (lookup) and commit (write) never
// drift out of sync with each other. Gender is included so a club's boys and girls
// squads sharing a club code/region/team number never collapse onto the same Team
// (see docs/plan.md postmortem on the "Mintonette" cross-gender merge bug).
export function computeLineageKey(
  clubExternalCode: string,
  regionCode: string,
  teamNumber: string,
  gender: string,
): string {
  return `${gender.toLowerCase()}:${clubExternalCode.toLowerCase()}:${regionCode.toLowerCase()}:${teamNumber.toLowerCase()}`;
}
