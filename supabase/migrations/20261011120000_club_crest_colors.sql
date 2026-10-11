-- Club crest colours for the Community club cards (Figma Community "Card /
-- Club wide", Cover=Crest): the crest's dominant colour, darkened so white
-- text reads on it, stored once instead of computed on every phone.
-- Rollback: supabase/rollbacks/20261011120000_club_crest_colors.down.sql
-- Probe:    supabase/tests/security/club_crest_colors_acl.probe.sql (read-only)
--
-- Its own table (not a profiles column): no profiles UPDATE, so neither the
-- updated_at trigger nor the column-level grants on profiles are touched.
-- crest_url records which crest the colour was taken from; a new crest makes
-- the row stale and the client recomputes it.
--
-- Read: anyone (decor on public club cards). Write: the club itself, for its
-- own row (set on crest upload). The backfill runs as the service role.

CREATE TABLE IF NOT EXISTS public.club_crest_colors (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  crest_url  text NOT NULL,
  color      text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.club_crest_colors IS
  'Dominant crest colour per club ("#rrggbb", already darkened for white text), keyed to the crest URL it came from.';

ALTER TABLE public.club_crest_colors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS club_crest_colors_read ON public.club_crest_colors;
CREATE POLICY club_crest_colors_read ON public.club_crest_colors
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS club_crest_colors_insert_own ON public.club_crest_colors;
CREATE POLICY club_crest_colors_insert_own ON public.club_crest_colors
  FOR INSERT TO authenticated WITH CHECK (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS club_crest_colors_update_own ON public.club_crest_colors;
CREATE POLICY club_crest_colors_update_own ON public.club_crest_colors
  FOR UPDATE TO authenticated USING (profile_id = (SELECT auth.uid())) WITH CHECK (profile_id = (SELECT auth.uid()));

REVOKE ALL ON public.club_crest_colors FROM PUBLIC;
GRANT SELECT ON public.club_crest_colors TO anon;
GRANT SELECT, INSERT, UPDATE ON public.club_crest_colors TO authenticated;
GRANT ALL ON public.club_crest_colors TO service_role;
