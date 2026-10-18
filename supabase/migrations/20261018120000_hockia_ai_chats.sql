-- Hockia AI chat history (handoff C2, Figma 180:344; ruling 2026-10-18:
-- kept 90 days, deletable one by one or all at once).
--
-- One row per conversation, private to its owner. `messages` holds the
-- conversation as the client shows it (capped in size); `title` / `summary`
-- / `kind` are the list row ("Defender roles in Europe" · "3 roles found").
-- Actions done from the sheet (application sent, profile filled) are rows of
-- their own with an in-app `link` and no messages.

CREATE TABLE IF NOT EXISTS public.hockia_ai_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'search'
    CHECK (kind IN ('search', 'question', 'role', 'apply', 'profile')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 160),
  link text CHECK (link IS NULL OR (char_length(link) <= 300 AND link LIKE '/%')),
  messages jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(messages) = 'array' AND pg_column_size(messages) <= 262144),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS hockia_ai_chats_user_updated_idx
  ON public.hockia_ai_chats (user_id, updated_at DESC);

ALTER TABLE public.hockia_ai_chats ENABLE ROW LEVEL SECURITY;

-- Owner only, every verb. Nobody else (admins included) reads chats.
DROP POLICY IF EXISTS hockia_ai_chats_owner_select ON public.hockia_ai_chats;
CREATE POLICY hockia_ai_chats_owner_select ON public.hockia_ai_chats
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS hockia_ai_chats_owner_insert ON public.hockia_ai_chats;
CREATE POLICY hockia_ai_chats_owner_insert ON public.hockia_ai_chats
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS hockia_ai_chats_owner_update ON public.hockia_ai_chats;
CREATE POLICY hockia_ai_chats_owner_update ON public.hockia_ai_chats
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS hockia_ai_chats_owner_delete ON public.hockia_ai_chats;
CREATE POLICY hockia_ai_chats_owner_delete ON public.hockia_ai_chats
  FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.hockia_ai_chats FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hockia_ai_chats TO authenticated;
GRANT ALL ON TABLE public.hockia_ai_chats TO service_role;

-- updated_at follows every save; the 90-day clock runs from the last message.
CREATE OR REPLACE FUNCTION public.hockia_ai_chats_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.hockia_ai_chats_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS hockia_ai_chats_touch ON public.hockia_ai_chats;
CREATE TRIGGER hockia_ai_chats_touch
  BEFORE UPDATE ON public.hockia_ai_chats
  FOR EACH ROW EXECUTE FUNCTION public.hockia_ai_chats_touch();

-- 90-day retention (ruling 2026-10-18).
CREATE OR REPLACE FUNCTION public.prune_hockia_ai_chats(p_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.hockia_ai_chats
  WHERE updated_at < timezone('utc', now()) - make_interval(days => GREATEST(p_days, 1));
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$function$;
REVOKE ALL ON FUNCTION public.prune_hockia_ai_chats(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_hockia_ai_chats(integer) TO service_role;

-- Daily at 04:05 UTC.
DO $$
BEGIN
  PERFORM cron.unschedule('prune_hockia_ai_chats_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('prune_hockia_ai_chats_daily', '5 4 * * *',
    $cron$SELECT public.prune_hockia_ai_chats(90);$cron$);
END $$;
