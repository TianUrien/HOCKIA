-- App version requirements for the in-app update check (soft + force update).
-- The NATIVE app reads its platform row and compares its bundled version:
--   installed < min_version    → "Update required" (blocking modal)
--   installed < latest_version → "Update available" (dismissible banner)
-- Web/PWA ignore this (always served fresh). min_version starts LOW so nobody is
-- force-updated until you deliberately raise it (e.g. to push users off a build
-- with a critical bug). latest_version is bumped each release to nudge updates.

set search_path = public;

CREATE TABLE IF NOT EXISTS public.app_version_requirements (
  platform        text PRIMARY KEY CHECK (platform IN ('ios', 'android')),
  min_version     text NOT NULL,
  latest_version  text NOT NULL,
  store_url       text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_version_requirements ENABLE ROW LEVEL SECURITY;

-- Public read (the app checks this before/at login). Writes are service-role
-- only: no INSERT/UPDATE/DELETE policy + REVOKE → anon/authenticated SELECT-only.
DROP POLICY IF EXISTS "app_version_requirements read" ON public.app_version_requirements;
CREATE POLICY "app_version_requirements read"
  ON public.app_version_requirements FOR SELECT USING (true);

INSERT INTO public.app_version_requirements (platform, min_version, latest_version, store_url) VALUES
  ('ios',     '1.0.0', '1.3.2', 'https://apps.apple.com/app/hockia/id6760937891'),
  ('android', '1.0',   '1.8',   'https://play.google.com/store/apps/details?id=com.inhockia.app')
ON CONFLICT (platform) DO UPDATE
  SET latest_version = EXCLUDED.latest_version,
      store_url      = EXCLUDED.store_url,
      updated_at     = now();

GRANT SELECT ON TABLE public.app_version_requirements TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.app_version_requirements FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
