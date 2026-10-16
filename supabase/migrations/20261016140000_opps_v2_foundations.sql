-- Opportunities v2 · Foundations (Figma handoff 2026-10-16, founder rulings 4 and 5).
-- Rollback: supabase/rollbacks/20261016140000_opps_v2_foundations.down.sql
-- Probe:    supabase/tests/security/opps_v2_foundations_acl.probe.sql (read-only)
--
-- 1. club_crest_colors gets the whole crest palette (jsonb, versioned) next to
--    the single colour, computed by ONE extractor (client/src/lib/crestPalette.ts)
--    and keyed to the same crest_url, so a new crest makes both stale together.
-- 2. Directory clubs (world_clubs) get a sibling table: roles posted for a
--    directory club render their cover in that club's colours. Directory
--    clubs have no owner session, so clients only read; admins write through
--    the RPC below (backfill tool in /admin/world).
-- 3. opportunities.cover_url (nullable): an optional cover photo chosen at
--    publish time. Column only — the bucket, upload UI and moderation ship
--    with the Publisher increment. Old native clients ignore the column.
--
-- Every object carries explicit grants (Oct-30 default-ACL rule).

-- ---------------------------------------------------------------- 1. palette
ALTER TABLE public.club_crest_colors ADD COLUMN IF NOT EXISTS palette jsonb;
ALTER TABLE public.club_crest_colors DROP CONSTRAINT IF EXISTS club_crest_colors_palette_shape;
ALTER TABLE public.club_crest_colors ADD CONSTRAINT club_crest_colors_palette_shape CHECK (
  palette IS NULL OR (
    jsonb_typeof(palette) = 'object'
    AND jsonb_typeof(palette -> 'v') = 'number'
    AND jsonb_typeof(palette -> 'stops') = 'array'
    AND pg_column_size(palette) < 2048
  )
);
COMMENT ON COLUMN public.club_crest_colors.palette IS
  'Crest palette for generated covers ({v, source, primary, secondary, stops[3], glow}); v = CREST_PALETTE_VERSION of the client extractor. NULL = not computed yet.';

-- ------------------------------------------------- 2. world_club_crest_colors
CREATE TABLE IF NOT EXISTS public.world_club_crest_colors (
  world_club_id uuid PRIMARY KEY REFERENCES public.world_clubs (id) ON DELETE CASCADE,
  crest_url     text NOT NULL,
  color         text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  palette       jsonb CHECK (
    palette IS NULL OR (
      jsonb_typeof(palette) = 'object'
      AND jsonb_typeof(palette -> 'v') = 'number'
      AND jsonb_typeof(palette -> 'stops') = 'array'
      AND pg_column_size(palette) < 2048
    )
  ),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.world_club_crest_colors IS
  'Crest colour + palette per directory club, keyed to the crest URL it came from. Written by admins only (admin_set_world_club_crest_colors).';

ALTER TABLE public.world_club_crest_colors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS world_club_crest_colors_read ON public.world_club_crest_colors;
CREATE POLICY world_club_crest_colors_read ON public.world_club_crest_colors
  FOR SELECT TO anon, authenticated USING (true);

REVOKE ALL ON public.world_club_crest_colors FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.world_club_crest_colors TO anon, authenticated;
GRANT ALL ON public.world_club_crest_colors TO service_role;

-- ------------------------------------------------------------ 3. admin RPCs
-- Rows whose palette is missing, older than p_version, or taken from another
-- crest than the one the profile / directory club shows today.
CREATE OR REPLACE FUNCTION public.admin_crest_backfill_candidates(p_version integer)
RETURNS TABLE (kind text, id uuid, name text, crest_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  RETURN QUERY
    SELECT 'profile'::text, p.id, p.full_name, p.avatar_url
    FROM public.profiles p
    LEFT JOIN public.club_crest_colors c ON c.profile_id = p.id
    WHERE p.role = 'club' AND p.avatar_url IS NOT NULL AND p.avatar_url <> ''
      AND (c.profile_id IS NULL OR c.crest_url <> p.avatar_url OR c.palette IS NULL
           OR COALESCE((c.palette ->> 'v')::integer, 0) < p_version)
    UNION ALL
    SELECT 'world_club'::text, w.id, w.club_name, w.avatar_url
    FROM public.world_clubs w
    LEFT JOIN public.world_club_crest_colors c ON c.world_club_id = w.id
    WHERE w.avatar_url IS NOT NULL AND w.avatar_url <> ''
      AND (c.world_club_id IS NULL OR c.crest_url <> w.avatar_url OR c.palette IS NULL
           OR COALESCE((c.palette ->> 'v')::integer, 0) < p_version)
    ORDER BY 1, 3
    LIMIT 500;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_crest_backfill_candidates(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_crest_backfill_candidates(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_crest_colors(p_profile_id uuid, p_crest_url text, p_color text, p_palette jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  INSERT INTO public.club_crest_colors (profile_id, crest_url, color, palette, updated_at)
  VALUES (p_profile_id, p_crest_url, p_color, p_palette, now())
  ON CONFLICT (profile_id) DO UPDATE
    SET crest_url = EXCLUDED.crest_url, color = EXCLUDED.color, palette = EXCLUDED.palette, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_crest_colors(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_crest_colors(uuid, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_world_club_crest_colors(p_world_club_id uuid, p_crest_url text, p_color text, p_palette jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  INSERT INTO public.world_club_crest_colors (world_club_id, crest_url, color, palette, updated_at)
  VALUES (p_world_club_id, p_crest_url, p_color, p_palette, now())
  ON CONFLICT (world_club_id) DO UPDATE
    SET crest_url = EXCLUDED.crest_url, color = EXCLUDED.color, palette = EXCLUDED.palette, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_world_club_crest_colors(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_world_club_crest_colors(uuid, text, text, jsonb) TO authenticated, service_role;

-- --------------------------------------------------------- 4. cover_url
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS cover_url text;
COMMENT ON COLUMN public.opportunities.cover_url IS
  'Optional cover photo for the role (Opportunities v2). NULL = generated cover in the club''s crest colours. Upload + moderation ship with the Publisher increment.';
