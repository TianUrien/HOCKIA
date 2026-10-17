# 0009 — One crest palette extractor, stored next to the crest colour

Status: accepted (founder, 2026-10-16, "Unify now"). Source: Opportunities v2
design handoff (Figma "05 · Opportunities — explorations", rulings 1, 2, 4, 5).

## Context

Opportunities v2 draws a generated cover in the club's crest colours whenever a
role has no photo. The app already picked ONE crest colour for Community club
cards and home role covers (`club_crest_colors`, 2026-10-11). Two pickers
would drift: a card and a cover for the same club could disagree, and a
yellow-only crest (black & amber) picked an olive card colour. Directory
clubs (`world_clubs`) had no colour at all, so a coach posting for a directory
club would have fallen back to purple.

## Decision

- `client/src/lib/crestPalette.ts` is the only extractor. It returns a
  versioned palette (`CREST_PALETTE_VERSION`): primary, secondary, three
  stops for the gradient, a glow. Yellow is weighted down and becomes the
  glow; a gold-only crest gets a warm near-black base; a monochrome crest gets
  graphite; nothing usable gets the Hockia violet fallback
  (`coverBackground(null)`).
- The single card colour is derived from that palette (`colorFromPalette`),
  so cards and covers always agree. A monochrome crest keeps the brand purple
  on cards (the pre-existing, approved look) and graphite on covers.
- The palette is stored in `club_crest_colors.palette` (jsonb, same row and
  same `crest_url` staleness rule as the colour) and, for directory clubs, in
  `world_club_crest_colors`. Clubs write their own row on crest upload or
  self-heal on view, but only when the crest changed or the stored palette is
  missing or older than the extractor (write guard). Directory clubs have no
  owner session, so only admins write them, through `admin_set_*` RPCs and
  the backfill tool on `/admin/world` (it computes in the browser with the
  same extractor; the DB never computes colours).
- Category colours (women `#be123c`, men `#0369a1`, mixed `#6c2bd9`, from the
  Figma `category/*` variables) live in the token build and appear only in
  chips, filter dots and the detail "Team" fact; never as a background.
- Who is behind a role is read from existing data by
  `client/src/lib/opportunityIdentity.ts`: the hiring club leads, "Posted by
  <coach>" names the coach who wrote it, and the detail copy follows
  ("What we offer", "In Ana's words", "Message Ana"). No new columns, so old
  roles render the same.
- `opportunities.cover_url` is added as a nullable column only; the upload,
  bucket and moderation ship with the Publisher increment.

## Consequences

- Any surface that needs a club colour or cover calls
  `useClubCrestColors` / `useClubCrestPalettes`; nobody reads pixels
  elsewhere.
- Raising `CREST_PALETTE_VERSION` invalidates stored palettes; the backfill
  tool lists them and clubs self-heal on view.
- Migration `20261016140000_opps_v2_foundations.sql` (rollback and read-only
  probe alongside).
