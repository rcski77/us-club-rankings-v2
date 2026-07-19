/** Given a rank and a division's point bands, finds the matching band's points (0 if none covers it). */
export function resolvePoints(
  rank: number,
  bands: { fromRank: number; toRank: number; points: number }[],
): number {
  const band = bands.find((b) => rank >= b.fromRank && (b.toRank === 0 || rank <= b.toRank));
  return band?.points ?? 0;
}
