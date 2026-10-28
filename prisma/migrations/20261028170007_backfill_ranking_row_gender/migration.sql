-- Data-only: rows computed before the gender partition existed all defaulted to
-- GIRLS when the column was added (add_gender_to_ranking_partitions), including old
-- weekly TeamRatingHistory snapshots that still hold boys teams from before the
-- girls-only filter. Retag every row with its team's gender (Team.gender was itself
-- corrected by that earlier migration), so lookups by (teamId, season, gender) or by
-- population never pick up a boys team's stale row as girls or vice versa. Skips any
-- row whose retagged key would collide with an existing row.

UPDATE "TeamRatingHistory" h
SET "gender" = t."gender"
FROM "Team" t
WHERE t."id" = h."teamId"
  AND h."gender" <> t."gender"
  AND NOT EXISTS (
    SELECT 1 FROM "TeamRatingHistory" o
    WHERE o."teamId" = h."teamId" AND o."seasonId" = h."seasonId" AND o."ageGroup" = h."ageGroup"
      AND o."gender" = t."gender" AND o."weekEndingDate" = h."weekEndingDate" AND o."ratingEngine" = h."ratingEngine"
  );

UPDATE "RankingResult" r
SET "gender" = t."gender"
FROM "Team" t
WHERE t."id" = r."teamId"
  AND r."gender" <> t."gender"
  AND NOT EXISTS (
    SELECT 1 FROM "RankingResult" o
    WHERE o."teamId" = r."teamId" AND o."seasonId" = r."seasonId" AND o."ageGroup" = r."ageGroup" AND o."gender" = t."gender"
  );

UPDATE "TeamEloMatchStep" s
SET "gender" = t."gender"
FROM "Team" t
WHERE t."id" = s."teamId"
  AND s."gender" <> t."gender";
