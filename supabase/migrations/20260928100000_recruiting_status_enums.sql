-- Track C · step 1 — new enum values for the invite → offer → signing flow (D3/D4).
--
-- Kept in its own migration on purpose: a value added with ALTER TYPE ... ADD VALUE
-- cannot be used in the same transaction, and 20260928110000 onwards uses them.
-- Enum values cannot be dropped again; nothing uses them until the functions in
-- 20260928110000/120000 are called, so an unused value is harmless.
--
-- application_status (founder ruling 2026-09-25: the D4 brief list):
--   offered                      the club sent an offer (opportunity_offers)
--   accepted                     the player accepted it
--   signed_pending_confirmation  the club marked the signing; waiting for the player
--   signed                       the player confirmed — the north-star signing
--   offer_declined               the player declined; recorded, then back to shortlisted
--   filled                       the role was filled; the application gets the kind note
--
-- profile_notification_kind:
--   recruiting_update            one kind for every invite / offer / signing event;
--                                metadata carries event, title and summary so clients
--                                that don't know the kind still show a readable item.

ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'offered';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'accepted';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'signed_pending_confirmation';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'signed';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'offer_declined';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'filled';

ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'recruiting_update';
