-- ─────────────────────────────────────────────────────────────────────
-- world_leagues — level_band_global + parent_pyramid + missing seeds
-- ─────────────────────────────────────────────────────────────────────
-- P1.2 of the Recruitment Build Spec v1.
--
-- The spec's `competitions` table is implemented as an in-place
-- extension of the existing `world_leagues` table (decision: keep
-- existing FKs from profiles / recruiting_context / world_clubs
-- intact, alias the spec's "competitions" name to world_leagues).
--
-- This migration:
--   1. Adds `level_band_global` (1..10 curated relative scale, 1=top
--      of world) so Club Fit's `competition_proximity` component
--      finally returns non-zero values for the first time. Today the
--      component always returns 0 because the cross-country gate has
--      no level data to anchor against — see clubFit.ts E.1.
--   2. Adds `parent_pyramid_id` (self-FK) for future
--      promotion/relegation pyramid tracking. Nullable, no values
--      seeded yet.
--   3. Seeds the 6 spec-required countries currently missing from
--      world_leagues: NL, IN, PK, MY, ZA, US — with their top 3
--      tiers each.
--   4. Backfills `level_band_global` on every existing row using a
--      curated mapping documented inline.
--
-- The 1..10 level_band_global scale is intentionally coarse so the
-- proximity formula `1 - clamp(|pg - cg| / 4, 0, 1)` produces
-- meaningful gradations: same band = 1.0, 4+ bands apart = 0.0.
-- Editorial calls are best-current-knowledge as of 2026-05-28 and
-- can be tuned later via admin SQL without code changes.
--
-- Reference for the curation (top-of-world → club-amateur):
--   1: Netherlands Hoofdklasse (men + women) — gold standard
--   2: Germany 1. Bundesliga, Belgian Hockey League, Australia
--      Hockey One, India Hockey League
--   3: Argentina Metro A, England Premier, Spain División de Honor,
--      US NCAA Division I
--   4: Belgium National 1, Australia Vic League 1 / Premier 2,
--      New Zealand Auckland, Italy Serie A Elite
--   5: Argentina Metro B, England Div One, Germany 2. Bundesliga,
--      Pakistan Premier League, South Africa Premier League,
--      Malaysia Hockey League, Italy Serie A1
--   6+: Lower tiers, regional divisions
--
-- Tiers within a country: a step of 2 in level_band_global per tier
-- is typical (tier 1 → tier 2 adds 2-3 bands).

BEGIN;

ALTER TABLE public.world_leagues
  ADD COLUMN IF NOT EXISTS level_band_global INTEGER
    CHECK (level_band_global IS NULL OR (level_band_global BETWEEN 1 AND 10));

ALTER TABLE public.world_leagues
  ADD COLUMN IF NOT EXISTS parent_pyramid_id INTEGER
    REFERENCES public.world_leagues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS world_leagues_level_band_idx
  ON public.world_leagues (level_band_global)
  WHERE level_band_global IS NOT NULL;

-- ── Backfill level_band_global for existing rows ─────────────────────
-- AR
UPDATE public.world_leagues SET level_band_global = 3 WHERE id = 1;  -- Torneo Metropolitano A
UPDATE public.world_leagues SET level_band_global = 5 WHERE id = 2;  -- Torneo Metropolitano B
UPDATE public.world_leagues SET level_band_global = 7 WHERE id = 3;  -- Torneo Metropolitano C
-- AU
UPDATE public.world_leagues SET level_band_global = 2 WHERE id = 6;  -- Hockey One League
UPDATE public.world_leagues SET level_band_global = 3 WHERE id = 7;  -- Premier League (state)
UPDATE public.world_leagues SET level_band_global = 3 WHERE id = 10; -- Premier League (state)
UPDATE public.world_leagues SET level_band_global = 4 WHERE id = 8;  -- Premier League 2
UPDATE public.world_leagues SET level_band_global = 4 WHERE id = 11; -- Vic League 1
UPDATE public.world_leagues SET level_band_global = 6 WHERE id = 9;  -- Premier League 3
UPDATE public.world_leagues SET level_band_global = 6 WHERE id = 12; -- Vic League 2
-- BE
UPDATE public.world_leagues SET level_band_global = 2 WHERE id = 38; -- Men's Belgian Hockey League
UPDATE public.world_leagues SET level_band_global = 2 WHERE id = 39; -- Women's Belgian Hockey League
UPDATE public.world_leagues SET level_band_global = 4 WHERE id = 40; -- National 1
-- DE
UPDATE public.world_leagues SET level_band_global = 2 WHERE id = 19; -- 1. Bundesliga
UPDATE public.world_leagues SET level_band_global = 5 WHERE id = 20; -- 2. Bundesliga
-- ES
UPDATE public.world_leagues SET level_band_global = 3 WHERE id = 35; -- División de Honor
UPDATE public.world_leagues SET level_band_global = 3 WHERE id = 36; -- División de Honor A (Liga Iberdrola)
UPDATE public.world_leagues SET level_band_global = 5 WHERE id = 37; -- División de Honor B
-- GB-ENG
UPDATE public.world_leagues SET level_band_global = 3 WHERE id = 13; -- Premier Division
UPDATE public.world_leagues SET level_band_global = 5 WHERE id = 14; -- Division One South
UPDATE public.world_leagues SET level_band_global = 5 WHERE id = 15; -- Division One North
-- IT (not in spec's 12 but already exists — keep)
UPDATE public.world_leagues SET level_band_global = 4 WHERE id = 16; -- Serie A Elite
UPDATE public.world_leagues SET level_band_global = 5 WHERE id = 17; -- Serie A1
UPDATE public.world_leagues SET level_band_global = 7 WHERE id = 18; -- Serie A2
-- NZ (not in spec's 12)
UPDATE public.world_leagues SET level_band_global = 4 WHERE id = 42; -- Auckland Premiership
UPDATE public.world_leagues SET level_band_global = 4 WHERE id = 43; -- Otago Club Competition
-- UY (not in spec's 12)
UPDATE public.world_leagues SET level_band_global = 6 WHERE id = 41; -- Primera Damas
UPDATE public.world_leagues SET level_band_global = 6 WHERE id = 44; -- FUH Primera Varones
UPDATE public.world_leagues SET level_band_global = 8 WHERE id = 45; -- FUH Intermedia A

-- ── Seed the missing spec-required countries ─────────────────────────
-- Inserts are idempotent via NOT EXISTS guards keyed on (country_id, name).
-- country_id values resolved from staging on 2026-05-28:
--   NL=30, IN=148, PK=167, MY=160, ZA=129, US=62

-- Netherlands — strongest field hockey league in the world
INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 30, 'Hoofdklasse Heren', 1, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 30 AND name = 'Hoofdklasse Heren');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 30, 'Hoofdklasse Dames', 1, 1, 2
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 30 AND name = 'Hoofdklasse Dames');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 30, 'Overgangsklasse', 2, 3, 3
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 30 AND name = 'Overgangsklasse');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 30, 'Promotieklasse', 3, 5, 4
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 30 AND name = 'Promotieklasse');

-- India — top international quality men's league
INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 148, 'Hockey India League', 1, 2, 1
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 148 AND name = 'Hockey India League');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 148, 'Hockey India Senior National Championship', 2, 4, 2
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 148 AND name = 'Hockey India Senior National Championship');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 148, 'State League', 3, 6, 3
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 148 AND name = 'State League');

-- Pakistan
INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 167, 'Pakistan Premier Hockey League', 1, 5, 1
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 167 AND name = 'Pakistan Premier Hockey League');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 167, 'National Hockey Championship', 2, 6, 2
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 167 AND name = 'National Hockey Championship');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 167, 'Provincial League', 3, 8, 3
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 167 AND name = 'Provincial League');

-- Malaysia
INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 160, 'Malaysia Hockey League', 1, 5, 1
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 160 AND name = 'Malaysia Hockey League');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 160, 'TNB Cup', 2, 6, 2
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 160 AND name = 'TNB Cup');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 160, 'Junior Hockey League', 3, 8, 3
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 160 AND name = 'Junior Hockey League');

-- South Africa
INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 129, 'Premier Hockey League', 1, 5, 1
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 129 AND name = 'Premier Hockey League');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 129, 'Indoor Premier League', 2, 6, 2
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 129 AND name = 'Indoor Premier League');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 129, 'Inter-Provincial Tournament', 3, 7, 3
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 129 AND name = 'Inter-Provincial Tournament');

-- United States — NCAA D1 is the top women's college pathway, very strong
INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 62, 'NCAA Division I', 1, 3, 1
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 62 AND name = 'NCAA Division I');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 62, 'NCAA Division II', 2, 5, 2
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 62 AND name = 'NCAA Division II');

INSERT INTO public.world_leagues (country_id, name, tier, level_band_global, display_order)
SELECT 62, 'NCAA Division III', 3, 7, 3
WHERE NOT EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = 62 AND name = 'NCAA Division III');

COMMIT;
