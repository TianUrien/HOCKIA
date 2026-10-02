# Figma changelog

Every edit to the Figma file "New-Hockia", newest first. Format:
`date · who · what · node ids`.

## 2026-10-02 (evening) · design agent

- Avatar `460:22`: sizes now match code (32, 52, 56, 80; was 32 / 48 / 72)
  and a new Shape property (Person = circle, Organisation = rounded square on
  white, as EntityAvatar). List rows follow at 52. Club avatars switched to
  Organisation: chat headers (D3.3, D4.3), Club fact rows (D1.3, D1.5,
  D4.1, D4.2, D4.4), D1.8 preview, D4.4 sheet pair (56), D4.5 crest (80).
- Package item `470:1660`: adopted the code set and order (BENEFIT_TILES):
  Paid, Housing, Flights, Job, Insurance, Bonuses, Visa, Car, Equipment,
  Meals, Education ("Other" removed); colours and icons now match the
  shipped tiles (founder ruling). Label style Body S Medium.
- New tokens: `accent/cyan-ink` #0e7490, `accent/indigo-ink` #4338ca,
  `accent/red-soft` #fee2e2, `accent/teal-soft-2` #e6f6f4.
- New lucide icons: Globe, Dumbbell, Utensils, Graduation cap, Dollar sign.

## 2026-10-02 (later) · design agent

- D4 · From yes to signed rebuilt with components (D4.1 `390:3`, D4.2
  `390:249`, D4.3 `390:557`, D4.4 `390:647`, D4.5 `390:936`, D4.6 `390:980`),
  following `lib/signing.ts` (road steps, offer card state, shipped copy,
  gender-neutral). Baseline on "Archive · D4 baseline".
- New components: Timeline step `480:198` (Done / Current / Upcoming /
  Skipped), Checkbox row `480:211`, Message / Offer card `480:5154`,
  Icon/Share `482:986`. Detail row `467:128`: Show chevron, wraps long
  values, hugs height.
- List item / Player `460:1973`: actions moved to a trailing column, one-line
  truncation, Invite label "Invite" (founder ruling). D3.1 / D3.2 follow.
- Tag `459:2050`: added Warning and Gold tones. Segmented control item
  `470:121`: Show dot. Switch `472:185`: On = status/positive. Checkbox row
  box radius = radius/sm.

## 2026-10-02 · design agent

- Tokens: "Hockia / Color" extended to 49 colours (hover/pressed, warning,
  danger-strong, focus, scrim, surface variants, exact-value accent and
  social colours); new "Hockia / Space & Radius" collection; 34 `Hockia/*`
  text styles; effect style `Hockia/Elevation/Sheet`.
- Whole file migrated to the tokens with no visual change (colours bound,
  text styles applied on exact metric matches, status bars and home
  indicators replaced by component instances). Archive pages untouched.
- Components created or extended on "03 · Components" (see
  [components.md](components.md)); legacy Tab bar v1, Tab bar v2 and
  Header v1 deleted (no instances).
- D3 · Invite to apply rebuilt with components (`393:2`, `393:178`,
  `393:351`, `393:452`); baseline on "Archive · D3 baseline".
- D1 · Recruiting rebuilt with components (D1.1–D1.10); baseline on
  "Archive · D1 Recruiting baseline"; screen titles aligned.
- "02 · Foundations": new live "Foundations v2" frame (`465:1741`).

## Earlier · code agent

- `ink/quaternary` description set during the colour-token alignment (PR #127).

## 2026-10-02 · code session (round 8, branch `fix/round8-design`)

Code-only changes that implement the founder rulings of 2 Oct; no Figma edit.

- Items 1/2 · `club/InviteAction.tsx`: the Find players / Shortlist row action is Button / Tonal, Small 36 with a 44 pt hit-slop; label "Invite", accessible name "Invite to apply". Tests `d3Invite.test.tsx` pin it.
- Item 9 · Decline offer stays neutral (Secondary trigger + Primary confirm); no code change (exception recorded by the design session in decisions.md).
- Items 6/11 · New `ui/ConfirmSheet.tsx` (Danger solid 48 + Cancel in a BottomSheet). Withdraw offer and Undo signing (`club/ApplicantReviewScreen.tsx`) and Not interested (`chat-v2/InviteCard.tsx`) use it; `ConfirmDialog` remains for desktop v1 only.
- Items 3/12/13 · 44 pt hit areas on every 36 px control (row icon buttons, Change role, Not interested, View role, road Message, Confirm signing prompt, My applications, Withdraw application); Large buttons are 48 px in InviteSheet, OfferSheet, MarkSignedSheet, DeclineSheet, ConfirmSigningPage, OwnApplicationRoad, the decision bar and the offer-decline sheet.
- Item 5 · Chat Invitation / Offer cards and their skeletons: radius 18 → `rounded-card` 16; note boxes 14 → 16.
- Item 15 · OfferSheet inputs 10 → `rounded-tile` 8, textarea 14 → `rounded-card` 16; MarkSignedSheet checkbox 6 → 8.
- Item 7 · Danger reds on tokens: text = `status/danger`, solid fill = `status/danger` with `danger-strong` pressed (DeclineSheet, decision bar, road menu, OwnApplicationRoad, ConfirmDialog, PostRoleScreen).
- Item 14 · OfferCard "Open until" pill reads its colour from `STATUS_TONE_PILL` (amber only for the player who must answer).
- Item 8 · Placeholder colour ink-4 → ink-3 at the 13 call sites.
- Item 19 · Textarea-inside-grouped-card (InviteSheet, DeclineSheet): `focus-within` brand ring on the card.
- Item 16 · Signing titles 28/26 → title-l 30 (`text-3xl`); Invitation / Offer card titles 19/18 → title-m 20 (`text-xl`).
- Item 17 · Confirm signing "Stop showing me to other clubs" row = `SettingsRow` + `SettingsSwitch` in a grouped card (copy unchanged).
