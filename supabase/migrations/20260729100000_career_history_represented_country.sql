-- Structured international experience — the product follow-up from
-- docs/ai/INTERNATIONAL_EXPERIENCE_DESIGN.md, founder-approved 2026-07-29.
--
-- Approach: structure the EXISTING "Representative Team" Journey entry
-- rather than adding a second profile section. The Journey editor gains a
-- country picker + level + optional caps on entry_type='national_team';
-- Hockia AI retrieval gets exact-ID matching instead of free-text parsing.
-- One surface, no duplicate timeline, legacy rows keep working via the
-- text-match fallback already in production.

ALTER TABLE career_history
  ADD COLUMN represented_country_id integer NULL REFERENCES countries(id),
  ADD COLUMN represented_level text NULL
    CHECK (represented_level IN ('senior', 'junior', 'masters')),
  ADD COLUMN caps integer NULL CHECK (caps >= 0);

COMMENT ON COLUMN career_history.represented_country_id IS
  'Country REPRESENTED on a national_team entry (not tournament host, not '
  'passport). Set by the Journey editor country picker; conservatively '
  'backfilled for legacy rows where the entry text named exactly one country.';
COMMENT ON COLUMN career_history.represented_level IS
  'senior | junior | masters — level of the representative side.';
COMMENT ON COLUMN career_history.caps IS
  'Optional self-reported international caps for this entry.';

CREATE INDEX idx_career_history_represented_country
  ON career_history (represented_country_id)
  WHERE represented_country_id IS NOT NULL;

-- ── Conservative legacy backfill ─────────────────────────────────────────
-- Same rules the live retrieval uses, so the backfill can never claim more
-- than the text already proved: HIGH-confidence aliases only (city-level
-- aliases like "buenos aires"→Argentina are medium and excluded — a
-- provincial selection must not become national caps), matched against
-- club_name/badge_label ONLY (division_league carries league names like
-- "Argentina League"; location_country is the tournament HOST). Rows where
-- the text names MORE than one country stay NULL — ambiguity is not data.
WITH matches AS (
  SELECT ch.id AS row_id, a.country_id
  FROM career_history ch
  JOIN country_text_aliases a
    ON a.confidence = 'high'
   AND (ch.club_name ILIKE '%' || a.alias_text || '%'
        OR COALESCE(ch.badge_label, '') ILIKE '%' || a.alias_text || '%')
  WHERE ch.entry_type = 'national_team'
    AND ch.represented_country_id IS NULL
  GROUP BY ch.id, a.country_id
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

-- Level backfill, only where a country was confidently matched (misfiled
-- rows — universities, clubs — stay fully NULL rather than being labelled).
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
