-- Fix: opportunity_published notification fan-out excludes test accounts
-- UNCONDITIONALLY, unlike every other test-account-sensitive surface in the
-- codebase (enqueue_application_digests, get_brands, get_brand_feed,
-- get_brand_by_slug, ...) which carve out staging with `OR is_staging_env()` so
-- QA/e2e works there while prod stays clean.
--
-- Consequence of the inconsistency: on STAGING, test-account players are never
-- notified when a club publishes a matching vacancy, so the notification e2e
-- (notifications.staging.spec.ts › "vacancy publish → player in-app
-- notification") could not verify the fan-out — its player fixture is a test
-- account. This aligns the fan-out with the house pattern.
--
-- PROD behavior is unchanged: is_staging_env() is false there, so the predicate
-- reduces to `is_test_account = false` exactly as before. Only the deployed
-- body's recipient predicate changes; everything else is the verbatim live body.

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
