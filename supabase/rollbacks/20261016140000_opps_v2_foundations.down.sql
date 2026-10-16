-- Rollback for 20261016140000_opps_v2_foundations.sql.
-- Drops the admin RPCs, the directory-club crest table, the palette column
-- and opportunities.cover_url. Stored palettes are lost (recomputed by the
-- backfill tool once the migration is re-applied).
DROP FUNCTION IF EXISTS public.admin_set_world_club_crest_colors(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.admin_set_crest_colors(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.admin_crest_backfill_candidates(integer);
DROP TABLE IF EXISTS public.world_club_crest_colors;
ALTER TABLE public.club_crest_colors DROP CONSTRAINT IF EXISTS club_crest_colors_palette_shape;
ALTER TABLE public.club_crest_colors DROP COLUMN IF EXISTS palette;
ALTER TABLE public.opportunities DROP COLUMN IF EXISTS cover_url;
