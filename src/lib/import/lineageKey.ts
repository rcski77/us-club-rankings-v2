// Mirrors Team.lineageKey's doc comment: derived from (club externalCode+region,
// teamNumber) -- stable across seasons even as the age-group digit in the source
// code changes. Single source of truth so resolve (lookup) and commit (write) never
// drift out of sync with each other.
export function computeLineageKey(
  clubExternalCode: string,
  regionCode: string,
  teamNumber: string,
): string {
  return `${clubExternalCode.toLowerCase()}:${regionCode.toLowerCase()}:${teamNumber.toLowerCase()}`;
}
