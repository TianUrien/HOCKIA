-- ============================================================================
-- Phase 1 · step 2 (founder ruling E): a role is announced ONCE — the first
-- time it is published. Closing and reopening / renewing it never re-announces.
--
-- Before this migration:
--   * EMAIL — notify-vacancy (DB webhook on opportunities) mailed every opted-in
--     player/coach on EVERY transition to 'open'. Its only dedupe was a 10-minute
--     email_sends lookback, so a club toggling closed->open every ~11 minutes
--     re-mailed the whole audience each time. published_at is re-stamped on
--     every reopen (set_opportunity_status_timestamps), and email_sends only
--     carries metadata.vacancy_id since 2026-07-02, so neither is a reliable
--     "was this ever announced" marker.
--   * IN-APP — handle_opportunity_published_notification dedupes per
--     (recipient, kind, opportunity), but recipients can DELETE their
--     notifications and prune_profile_notifications deletes them after 90 days,
--     so a reopen re-notified anyone whose row was gone, plus everyone who
--     joined since.
--
-- After:
--   * public.opportunity_first_publications holds one row per opportunity that
--     has EVER been published. Server-only: no anon/authenticated privileges,
--     RLS on with no policies, so no client can create, reset or delete it.
--   * The in-app fan-out runs only when the trigger creates that row (i.e. the
--     first draft->open / INSERT-as-open).
--   * notify-vacancy calls claim_opportunity_announcement_email(), which
--     atomically stamps email_claimed_at once; only the caller that wins the
--     claim sends. This also covers webhook double-delivery and races.
--   * Backfill: every opportunity already published (status <> 'draft' or a
--     published_at) is recorded as already announced, so no existing role can
--     re-mail on its next reopen. Drafts that were never published get no row
--     and still announce on their first publish.
-- ============================================================================

-- 1) The marker table -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunity_first_publications (
  opportunity_id     uuid PRIMARY KEY
                     REFERENCES public.opportunities(id) ON DELETE CASCADE,
  first_published_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  email_claimed_at   timestamptz
);

COMMENT ON TABLE public.opportunity_first_publications IS
  'One row per opportunity that has ever been published (founder ruling E: announce a role once). '
  'Written only by the opportunity_published_notify trigger and claim_opportunity_announcement_email(). '
  'email_claimed_at = the moment notify-vacancy won the right to send the new-role email.';

ALTER TABLE public.opportunity_first_publications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.opportunity_first_publications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.opportunity_first_publications TO service_role;

-- 2) Backfill: everything already published counts as announced -------------
-- Inserts into the NEW table only; no trigger on opportunities fires.
INSERT INTO public.opportunity_first_publications (opportunity_id, first_published_at, email_claimed_at)
SELECT o.id,
       COALESCE(o.published_at, o.created_at, timezone('utc', now())),
       COALESCE(o.published_at, o.created_at, timezone('utc', now()))
  FROM public.opportunities o
 WHERE o.status <> 'draft' OR o.published_at IS NOT NULL
ON CONFLICT (opportunity_id) DO NOTHING;

-- 3) Email claim used by notify-vacancy (service_role only) ------------------
-- Returns true exactly once per opportunity, ever. Upsert so it also works if
-- the marker row is somehow missing (e.g. trigger disabled during maintenance).
CREATE OR REPLACE FUNCTION public.claim_opportunity_announcement_email(p_opportunity_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed uuid;
BEGIN
  INSERT INTO public.opportunity_first_publications AS f
         (opportunity_id, first_published_at, email_claimed_at)
  VALUES (p_opportunity_id, timezone('utc', now()), timezone('utc', now()))
  ON CONFLICT (opportunity_id) DO UPDATE
     SET email_claimed_at = timezone('utc', now())
   WHERE f.email_claimed_at IS NULL
  RETURNING f.opportunity_id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_opportunity_announcement_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_opportunity_announcement_email(uuid) TO service_role;

-- 4) In-app fan-out: first publication only ----------------------------------
-- Same body as live (md5 a4ea6f26… on prod and staging), plus the marker gate.
CREATE OR REPLACE FUNCTION public.handle_opportunity_published_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  now_ts timestamptz := timezone('utc', now());
  v_club_name text;
BEGIN
  -- Only fire when status transitions to 'open'
  IF TG_OP = 'INSERT' THEN
    IF NEW.status != 'open' THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status != 'open' OR OLD.status IS NOT DISTINCT FROM 'open' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Founder ruling E: announce a role only the FIRST time it is published.
  -- A reopen / renewal finds the marker row already there and stops here.
  INSERT INTO public.opportunity_first_publications (opportunity_id, first_published_at)
  VALUES (NEW.id, now_ts)
  ON CONFLICT (opportunity_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Get the publishing club's name for notification metadata
  SELECT full_name INTO v_club_name
  FROM public.profiles
  WHERE id = NEW.club_id;

  -- Bulk insert: one notification per eligible player/coach
  INSERT INTO public.profile_notifications (
    recipient_profile_id,
    actor_profile_id,
    kind,
    source_entity_id,
    metadata,
    target_url,
    created_at,
    updated_at
  )
  SELECT
    p.id,
    NEW.club_id,
    'opportunity_published'::public.profile_notification_kind,
    NEW.id,
    jsonb_build_object(
      'opportunity_id', NEW.id,
      'opportunity_title', NEW.title,
      'club_id', NEW.club_id,
      'club_name', coalesce(v_club_name, 'A club'),
      'opportunity_type', NEW.opportunity_type::text,
      'position', NEW.position::text,
      'location_city', NEW.location_city,
      'location_country', NEW.location_country
    ),
    '/opportunities/' || NEW.id::text,
    now_ts,
    now_ts
  FROM public.profiles p
  WHERE p.role = NEW.opportunity_type::text
    AND p.onboarding_completed = true
    -- Test accounts are eligible ONLY on staging (house pattern), so the
    -- notification fan-out is QA-able there; on prod this is is_test_account=false.
    AND (p.is_test_account = false OR public.is_staging_env())
    AND p.id != NEW.club_id
  ON CONFLICT (recipient_profile_id, kind, source_entity_id)
    WHERE source_entity_id IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$function$;
