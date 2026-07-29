-- Repair the 20260729100000 backfill.
--
-- The prod audit of that backfill found three wrong assignments, one root
-- cause: SUBSTRING ILIKE matching. Alias "us" matched inside
-- "University of MassachUSetts" → United States; alias "american" matched
-- inside "2022 Pan American Cup" (a continental tournament, host Chile) →
-- United States; "2026 South African Series" (host series) → South Africa.
--
-- Same three guards the live retrieval now uses
-- (_shared/international-taxonomy.ts rowTextMatchesCountry):
--   1. word-boundary matching (\y), never substring;
--   2. rows containing a tournament name never country-match from text;
--   3. rows whose title starts with a year are event entries, never teams.
--
-- Safe to reset everything: the Journey editor that lets USERS set these
-- fields ships in the same release, so at repair time every non-NULL value
-- came from the earlier backfill.

UPDATE career_history
SET represented_country_id = NULL, represented_level = NULL
WHERE entry_type = 'national_team';

WITH candidate_rows AS (
  SELECT ch.id AS row_id,
         ch.club_name || ' ' || COALESCE(ch.badge_label, '') AS title
  FROM career_history ch
  WHERE ch.entry_type = 'national_team'
    -- guard 3: year-prefixed titles are events, not teams
    AND ch.club_name !~ '^\s*(19|20)\d{2}'
    -- guard 2: tournament names never donate a country adjective
    AND (ch.club_name || ' ' || COALESCE(ch.badge_label, '')) !~*
        '(pan.?american|world cup|nations? cup|olympic|commonwealth|champions trophy|euro ?hockey|african? (cup|series)|asian? (cup|games)|oceania cup|pro league)'
),
matches AS (
  SELECT cr.row_id, a.country_id
  FROM candidate_rows cr
  JOIN country_text_aliases a
    ON a.confidence = 'high'
   -- aliases are matched word-bounded; non-word alias chars would break the
   -- regex, so restrict to plain word/space aliases (all real ones are)
   AND a.alias_text ~ '^[a-z0-9 ]+$'
   AND cr.title ~* ('\y' || a.alias_text || '\y')
  GROUP BY cr.row_id, a.country_id
),
unambiguous AS (
  SELECT row_id, min(country_id) AS country_id
  FROM matches
  GROUP BY row_id
  HAVING count(DISTINCT country_id) = 1
)
UPDATE career_history ch
SET represented_country_id = u.country_id
FROM unambiguous u
WHERE ch.id = u.row_id;

UPDATE career_history
SET represented_level = CASE
  WHEN (club_name || ' ' || COALESCE(badge_label, '') || ' ' || COALESCE(division_league, ''))
       ~* '(^|[^a-z0-9])(u-?1[4-9]|u-?2[13]|junior|juvenil|youth|sub[- ]?(19|21))([^a-z0-9]|$)'
    THEN 'junior'
  WHEN (club_name || ' ' || COALESCE(badge_label, '') || ' ' || COALESCE(division_league, ''))
       ~* '(^|[^a-z0-9])(masters|master''s|o35|o40|o45|o50|o60)([^a-z0-9]|$)'
    THEN 'masters'
  ELSE 'senior'
END
WHERE entry_type = 'national_team'
  AND represented_level IS NULL
  AND represented_country_id IS NOT NULL;
