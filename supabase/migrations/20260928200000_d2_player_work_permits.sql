-- =========================================================================
-- D2 · 30-second profile — slice 1 · visas & work permits
-- =========================================================================
-- Founder rulings 2026-09-26:
--   * Permit details (type, dates) are visible to the owner and to recruiters
--     (public.is_recruiter: clubs, and coaches who recruit for their team) only.
--     Everyone else sees only the passport line on the profile.
--   * Permits are SHOWN, not enforced: application eligibility stays
--     EU-passport only (check_application_eligibility is not touched here).
--   * Expiry = an amber row on the owner's profile and permits screen; no email
--     or push. work_permit_status() exposes expiring_soon (<= 30 days) / expired.
--   * Expiry is OPTIONAL for every permit type. A permit with no expiry is valid
--     (never expiring_soon / expired); a future start date still makes it
--     not_yet_valid.
--
-- Passports stay in profiles.nationality_country_id / nationality2_country_id
-- (max two). EU status is derived from them (eu_country_ids()), never typed.
--
-- No UPDATE runs on public.profiles in this migration.
-- =========================================================================

-- ── 1. Table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.player_work_permits (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  country_id  integer     NOT NULL REFERENCES public.countries(id),
  type        text        NOT NULL,
  valid_from  date,
  expires_on  date,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT player_work_permits_type_check
    CHECK (type IN ('visa', 'work_permit', 'residency')),
  CONSTRAINT player_work_permits_dates_check
    CHECK (valid_from IS NULL OR expires_on IS NULL OR valid_from <= expires_on),
  CONSTRAINT player_work_permits_expires_sane
    CHECK (expires_on IS NULL OR (expires_on >= DATE '2000-01-01' AND expires_on <= DATE '2100-12-31'))
);

CREATE INDEX IF NOT EXISTS idx_player_work_permits_player
  ON public.player_work_permits (player_id, expires_on DESC NULLS FIRST);

COMMENT ON TABLE public.player_work_permits IS
  'D2: visas / work permits / residency a player holds. Owner full CRUD; recruiters '
  '(is_recruiter) read rows of non-hidden players; nobody else. Shown, not enforced.';

-- ── 2. Status helper (pure; the client mirrors it in lib/workPermits.ts) ───
CREATE OR REPLACE FUNCTION public.work_permit_status(
  p_valid_from date,
  p_expires_on date,
  p_today      date DEFAULT (timezone('utc', now()))::date
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_expires_on IS NOT NULL AND p_expires_on < p_today       THEN 'expired'
    WHEN p_valid_from IS NOT NULL AND p_valid_from > p_today       THEN 'not_yet_valid'
    WHEN p_expires_on IS NOT NULL AND p_expires_on - p_today <= 30 THEN 'expiring_soon'
    ELSE 'valid'   -- includes a permit with no expiry
  END
$$;

COMMENT ON FUNCTION public.work_permit_status(date, date, date) IS
  'D2: valid | expiring_soon (expires within 30 days, still valid) | expired | not_yet_valid. '
  'valid and expiring_soon both count as a valid permit. No expiry (NULL) = valid unless the start is in the future.';

REVOKE ALL ON FUNCTION public.work_permit_status(date, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_permit_status(date, date, date) TO anon, authenticated, service_role;

-- ── 3. Guard: direct client writes (current_user = 'authenticated') ────────
-- RLS already pins player_id to the caller; this keeps timestamps honest,
-- makes player_id immutable, limits the list and keeps the table player-only.
CREATE OR REPLACE FUNCTION public.guard_player_work_permit_client_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role  text;
  v_count int;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = NEW.player_id;
    IF v_role IS DISTINCT FROM 'player' THEN
      RAISE EXCEPTION 'Only players can add visas and work permits' USING ERRCODE = '42501';
    END IF;
    SELECT count(*) INTO v_count FROM public.player_work_permits w WHERE w.player_id = NEW.player_id;
    IF v_count >= 10 THEN
      RAISE EXCEPTION 'You can add up to 10 visas and permits' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := timezone('utc', now());
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.player_id IS DISTINCT FROM OLD.player_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A permit''s owner and creation time cannot change' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_player_work_permit_client_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_player_work_permit_client_write() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_player_work_permit_client_write ON public.player_work_permits;
CREATE TRIGGER trg_guard_player_work_permit_client_write
  BEFORE INSERT OR UPDATE ON public.player_work_permits
  FOR EACH ROW EXECUTE FUNCTION public.guard_player_work_permit_client_write();

-- ── 4. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.player_work_permits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS player_work_permits_owner_select ON public.player_work_permits;
CREATE POLICY player_work_permits_owner_select ON public.player_work_permits
  FOR SELECT TO authenticated
  USING (player_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS player_work_permits_recruiter_select ON public.player_work_permits;
CREATE POLICY player_work_permits_recruiter_select ON public.player_work_permits
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_recruiter((SELECT auth.uid())))
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = player_work_permits.player_id
         AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    )
  );

DROP POLICY IF EXISTS player_work_permits_owner_insert ON public.player_work_permits;
CREATE POLICY player_work_permits_owner_insert ON public.player_work_permits
  FOR INSERT TO authenticated
  WITH CHECK (player_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS player_work_permits_owner_update ON public.player_work_permits;
CREATE POLICY player_work_permits_owner_update ON public.player_work_permits
  FOR UPDATE TO authenticated
  USING (player_id = (SELECT auth.uid()))
  WITH CHECK (player_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS player_work_permits_owner_delete ON public.player_work_permits;
CREATE POLICY player_work_permits_owner_delete ON public.player_work_permits
  FOR DELETE TO authenticated
  USING (player_id = (SELECT auth.uid()));

-- ── 5. Grants (explicit: required since the Oct 2026 default-ACL change) ───
REVOKE ALL ON TABLE public.player_work_permits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.player_work_permits TO authenticated;
GRANT ALL ON TABLE public.player_work_permits TO service_role;
