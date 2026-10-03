# Figma changelog

Every edit to the Figma file "New-Hockia", newest first. Format:
`date · who · what · node ids`.

## 2026-10-03 (evening) · design agent

- Player gaps, page "04 · Player — Live" (founder rulings via the code agent):
  - Search v2 `42:195` on components: Search field, AI row on brand-soft,
    new List item / Member result `521:387` (Avatar 48, RoleBadge), clubs
    show location only, no green dot. New states: recent (empty query)
    `522:1436`, no results `522:1558` ("No members match “zzqxwv”").
  - Your week v2: zero-views state `523:1482` ("No profile views yet this
    week" in grey, no viewer rail, tiles at 0, check-in stays). "What
    happened" stays all grey.
  - Hockia AI v2 states: first use `524:1494`, loading `524:1575`, no match
    `524:1644`, can’t answer `524:1715`, error `524:1785` (neutral grey,
    never amber).
  - Onboarding copy as shipped (PR #184): Choose your role `101:892`
    (role lines, Brand before Umpire, "You can’t change it later without
    support."), First run `104:2096` terms line, Set up step 2 subtitle,
    date-of-birth helper on step 1; age gate 18+ (also Settings and its
    dev note).
- New components: Role badge `518:7691` (RoleBadge colours) with tokens
  `role/*` (player, coach, club, brand; coach ink aliases `accent/teal`);
  List item / Member result `521:387`; Avatar Size 48.

## 2026-10-03 (later) · design agent

- D1 · Profile & Network rebuilt with components (D1.11 `337:372`, D1.12
  `337:588`, D1.13 `338:424`, D1.14 `338:495`, D1.15 `338:575`, D1.16
  `352:450`, D1.17 `352:995`, D1.18 `352:1290`, D1.19 `353:502`, D1.20
  `353:718`, D1.21 `353:809`, D1.22 `353:893`, D1.23 `355:528`); prototype
  links kept. Baseline on "Archive · D1 Profile & Network baseline".
- New components: List item / Conversation `494:2377`, Card / Member
  `501:6648`, Card / Your week `505:3148`, and a Feed set (section `503:218`)
  that mirrors `components/home`: Feed / Header `503:241` (Trailing More or
  Badge), Feed / Interaction bar `503:274` (Post, Question), Feed / Action
  `503:246` (Neutral, Primary) and one component per item type (User post,
  Question, Video added, Media added, Opportunity posted, Open to play,
  Reference received, Club responded, Member joined, Milestone, Role filled).
- Extended: Avatar `460:22` Size 40 (feed, Avatar `md`); Icon button
  `459:171` Style Glass (round button over cover photos); Status bar is now
  the set "System / Status bar" `507:397` with Appearance Dark and Light.
- Copy now matches the shipped strings and is gender-neutral on D1, D3 and
  D4: "Marked available", "Can’t compare yet — Club: Old Lions has no league
  on Hockia.", "…coaches and teammates can write one.", the decline-sheet
  helper and footnote (`DeclineSheet.tsx`), the invite footer
  (`lib/invites.ts`), and "ask when their season ends".
- Feed / Opportunity posted `504:593`: "EU passport required" line removed
  (matches the shipped card; requirements live on the role page).

## 2026-10-03 · design agent

- New screen D3.3b · Not interested — confirm (player) `496:1448`: neutral
  bottom sheet (founder ruling) with Primary "Not interested" (busy label
  "Sending…") and Tertiary "Cancel" (every sheet's way out is "Cancel"). Body
  matches the round-8 copy: "<Club name> will see that you passed. You can
  still message them." Prototype: the card's "Not interested" opens it,
  "Cancel" goes back.
- New component List item / Conversation `494:2377` (Dot: None, Warning ·
  Name, Date, Meta, Preview). D1.19 Inbox `353:502` rows now use it; photos,
  amber dots and the row link to D1.20 kept.

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
