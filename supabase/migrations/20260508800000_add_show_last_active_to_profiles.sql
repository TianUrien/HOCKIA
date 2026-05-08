-- profiles.show_last_active — per-user opt-out for the LastActivePill.
--
-- The pill was shipped in commit 37a3693 with two of three privacy
-- guarantees (auth-only viewers + bucketed labels). The third —
-- per-user opt-out — was deferred pending this column. Defaulting to
-- true means presence is visible by default (matches current behavior),
-- and any user who toggles their Settings → Privacy → "Show your last
-- activity" off flips it to false. LastActivePill checks the column
-- and renders nothing when false, regardless of viewer auth state.
--
-- Default true is the conservative choice for a column added to an
-- existing user base: existing users keep current behavior; only users
-- who actively want to hide presence change it. NOT NULL so client
-- code never has to handle the tri-state (true / false / null).

ALTER TABLE public.profiles
  ADD COLUMN show_last_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.show_last_active IS
  'Per-user opt-out for LastActivePill on public profile headers. '
  'When false the pill is hidden for all viewers regardless of '
  'last_active_at. Default true for backward compatibility.';
