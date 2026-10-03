# Implementation feedback

Written by the code agent; answered in place by the design agent. Resolved
items move to [decisions.md](decisions.md).

Verified against `client/src` on 2026-10-02 (branch `staging`, after PR #166
tokens / radius and PR #168). File references are `path:line` under
`client/src/`. The README protocol keeps [components.md](components.md)
design-owned, so the "Code counterpart" column is confirmed or corrected here
rather than edited there.

## Constraints to design within (from the code side, 2026-10-02)

- Phone-first: Club v2 (D1–D6) is phone-only at 393 px; desktop stays v1.
- Icons: `lucide-react` or inline SVG only (bundle gate).
- Respect safe-area insets; no hover-only affordances.
- Components whose API must stay stable: BottomSheet, MoreMenu (Report in
  every "…"), MobileBottomNav, SettingsSwitch / SheetActions (Cancel + Save),
  FitCard, chat InviteCard / OfferCard (don't change card heights abruptly),
  EntityAvatar.
- Application statuses are fixed (pending, shortlisted, maybe, rejected,
  no_response, withdrawn, filled, offered, accepted,
  signed_pending_confirmation, signed, offer_declined); only SQL functions
  change them.
- Copy is gender-neutral and in sentence case.
- Bundle gates: 480 KB gzip first load, 4800 KB raw total.

Rules already enforced in code (from `docs/engineering/standards.md`), which
every Figma screen has to satisfy:

- **Amber only when the viewer must act.** The same status is amber for one
  viewer and grey for the other (`lib/statusTone.ts`, `lib/signing.ts`
  `offerCardState`; test `__tests__/amberRule.test.tsx`). Trust is gold,
  never amber. Closed outcomes are grey. A Figma screen that shows amber to a
  viewer who is waiting will not be built that way.
- **Gender-neutral copy**: never his/her/him; the person's name or "they".
  Captions in Figma that use pronouns are rewritten in code.
- **Players never see counts, scores, levels or reply-time estimates**
  (`lib/opportunityCopy.ts`). Fit badge, Stat and applicant counts are
  club-only surfaces; nothing on a player screen may carry them.
- **Red dots, no numbers** on the tab bar and Inbox segments
  (`MobileBottomNav.tsx:115`, `ui/SegmentedControl.tsx:62`).
- **Status words come from shared helpers** (`lib/applicationStatus.ts`,
  `lib/invites.ts`, `lib/signing.ts`, `lib/clubInviteCopy.ts`…), never
  inline strings. New status labels in Figma are added to the helper first.
- **Lazy routes and bundle gates**: every Club v2 phone screen and every
  sheet with its own data (InviteSheet, OfferSheet, MarkSignedSheet,
  ApplyToOpportunityModal) is a lazy chunk. A new screen or heavy sheet must
  be splittable; nothing phone-only may enter the eager bundle.
- **Font**: Inter on the web, the system font in the native apps
  (`globals.css:23-28`, `html[data-native='1']`). Figma's SF Pro metrics are
  implemented through the Tailwind `fontSize` scale (large-title 34, title 22,
  body 17, row 15, secondary 13, caption 12, micro 11, tab 10) and the 34
  `--text-*` styles in `styles/tokens/tokens.css`.
- **Radius** after PR #166: tile 8 (`rounded-tile`), card 16 (`rounded-card`,
  equals Tailwind `rounded-2xl`), sheet 20 (`rounded-sheet`); tokens also
  carry `md` 12 and `full`. Any other radius in Figma needs a token first.
- **Focus ring** is global: `*:focus-visible` = 2 px brand outline, 2 px
  offset (`globals.css:521`). Components do not need a Focus variant in
  code; inputs that set `outline-none` must supply their own focus state.
- **`ink/quaternary` (ink-4) is never text**: placeholders, chevrons,
  disabled icons, dividers only (2.2:1 on white). Readable secondary text is
  ink-3 or ink-2.
- **Tokens flow one way**: Figma variables → `figma-export.json` →
  `npm run tokens:build` → `tokens.js` / `tokens.css` → Tailwind. A colour
  that only exists as a hex in Figma cannot be referenced from code.

## Code counterparts (verified 2026-10-02)

Verdicts: **confirmed** = the proposed file is the counterpart;
**corrected** = a different or more precise file; **missing** = no reusable
component yet (the pattern is inline; the closest instances are listed).

Totals over the 35 components plus Icons in components.md: **7 confirmed,
16 corrected, 12 missing, 1 n/a.**

### Actions

| Component | Node | Verdict | Code counterpart | Props / variants in code · where used |
|---|---|---|---|---|
| Button | `459:146` | missing | — | `components/Button.tsx` is the legacy desktop/landing button (variants primary · glass · outline, sizes sm/md/lg; 2 importers) and is not the Figma set. D1–D4 render every button inline: Primary `h-[50px] rounded-full bg-hockia-primary text-white font-semibold` (`club/InviteSheet.tsx:200`, `club/OfferSheet.tsx:144`, `club/MarkSignedSheet.tsx:62`, `pages/ConfirmSigningPage.tsx:176`); Secondary `border border-line bg-white` (`features/chat-v2/components/OfferCard.tsx:117`, `InviteCard.tsx:136`); Tertiary text `h-11 text-ink-1` (`MarkSignedSheet.tsx:65`); Link `text-hockia-primary font-semibold` (`InviteSheet.tsx:161`); Destructive soft `bg-surface-grouped text-[#e5484d]` (`club/ApplicantReviewScreen.tsx:493`); Danger solid `bg-[#e5484d]` (`club/DeclineSheet.tsx:112`) or `bg-red-600` (`opportunities/OwnApplicationRoad.tsx:118`, `components/ConfirmDialog.tsx:88`). Loading = label swap ("Sending…"). `SheetActions` (`settings/settingsUi.tsx:90`) is the Cancel + Save pair. Recommended: a `ui/Button.tsx` with the seven Figma styles before D2–D6 start |
| Icon button | `459:171` | corrected (partial) | `ui/IconButton.tsx` = Ghost 44 only | Props `label` (aria-label + title), native button attrs; 4 importers (RolePostedScreen, OpportunityDetailMobile, InboxPage, OpportunitiesPage). Muted 36 and Tonal 36 are inline `h-9 w-9 rounded-full bg-surface-grouped` / `bg-hockia-soft` (`club/FindPlayersScreen.tsx:178,184`, `club/ShortlistScreen.tsx:159`); the road bar "…" is 48 (`ApplicantReviewScreen.tsx:511`) |
| Chip | `459:184` | missing | — | Three inline styles: filter tabs with Selected = `bg-ink-1 text-white` (`club/ApplicantsScreen.tsx:107`, `ShortlistScreen.tsx:116`, `FindPlayersScreen.tsx:145`, `DeclineSheet.tsx:75-81`); form multi-select `Chips` with Selected = `bg-hockia-soft text-hockia-primary` + check (`club/roleFormUi.tsx:63`, used by PostRoleScreen, OfferSheet, NewContextSheet); legacy `DiscoverFilterChips`, `discover/ActionChipRow`, `SpecialistSkillsSelect`. Two Selected treatments for one component |
| Segmented control | `470:122` | confirmed (+1) | `ui/SegmentedControl.tsx` | Props `options[{value,label,count?,dot?}]`, `value`, `onChange`, `ariaLabel`; role=tablist, 30 px items; used by ClubOpportunitiesScreen, InboxPage, MyApplicationsPage, OpportunitiesPage. A second implementation, `Segments` in `club/roleFormUi.tsx:41` (role=radiogroup, nullable value), serves the forms. `count` ("Open · 4") and `dot` exist in code and not in the Figma component |
| Switch | `472:185` | confirmed | `SettingsSwitch` in `settings/settingsUi.tsx:28` | 51×31, on = `bg-positive`, off = `bg-line`; props `checked`, `onChange`, `disabled`, `label`; used by ClubEditScreen, PostRoleScreen, EditProfileScreen, OpenToPlayScreen, ConfirmSigningPage |
| Text field | `472:243` | missing | — | Inline input class in `club/ClubEditScreen.tsx:44` (`h-[50px] rounded-[12px] bg-surface-grouped … focus:ring-2 ring-hockia-primary/30`), `club/PostRoleScreen.tsx:308,425`, `club/NewContextSheet.tsx:89`, `settings/SettingsMobile.tsx:69`; textarea-inside-grouped-card pattern (`InviteSheet.tsx:179`, `DeclineSheet.tsx:96`); Select = native `<select>` (`OfferSheet.tsx:103`). Focus keeps the muted fill and adds a 30 % ring — Figma says white fill + brand border |

### Status and feedback

| Component | Node | Verdict | Code counterpart | Props / variants in code · where used |
|---|---|---|---|---|
| Tag | `459:2050` | missing | — | Neutral pill inline at two sizes: `px-2 py-0.5 text-caption` (`club/ApplicantsScreen.tsx:136`) and `px-3 py-1.5 text-secondary` (`club/InviteAction.tsx:22-29`, `InviteCard.tsx:150-152`, `OfferCard.tsx:127`). Brand "Invited" / "New" are plain purple text, not pills (`ApplicantsScreen.tsx:137-138`). Positive = `profile/SignedThroughHockiaPill`. `lib/statusTone.ts` `STATUS_TONE_PILL` maps amber / grey / gold, which is a different tone set from Brand / Neutral / Positive |
| Fit badge | `459:2043` | corrected | `club/FitChip.tsx` | `state` green → "Strong fit", yellow → "Possible fit", grey → renders nothing; three-bar meter; 8 importers. `club/FitCard.tsx` is the card around it (Fit for this role + check rows) |
| Callout | `460:23` | missing | — | Grouped-card note `InviteLimitNotice` (`club/InviteAction.tsx:48`); end-of-content footnotes `text-caption text-ink-3` (`club/FitCard.tsx:30`, `InviteSheet.tsx:192`, `DeclineSheet.tsx:107`). No icon variant |
| Banner | `470:160` | missing | — | Pre-token `components/CategoryConfirmationBanner.tsx`, `components/PublicViewBanner.tsx`. Closest tappable attention item on the phone: `club/ChatApplicationCard.tsx` (amber at ≤ 5 days) |
| Stat | `470:167` | corrected | `home/pulse/StatTile.tsx` | Props `value`, `label`, `delta`, `accent`; legacy `gray-*` classes; used by Pulse `PlayerHero` and `ClubHero`. Note: it renders on the player Pulse hero (profile views), while Figma marks Stat club-only. Club pipeline counts in `club/ClubOpportunitiesScreen.tsx:264` are inline text |
| Package item | `470:1660` | corrected | `lib/opportunityCopy.ts` `BENEFIT_TILES` (`:132`) + inline row | Rendered in `opportunities/OpportunityDetailMobile.tsx:240` (32 px tile, icon + label + detail). Type set differs: Figma Paid · Housing · Flights · Insurance · Job · Car · Visa · Other; code housing · flights · job · insurance · bonuses · visa · car · equipment · meals · education (+ free-text custom). Tile colours are hex literals, not the `accent-*` tokens |
| Package option | `472:260` | missing | — | Inline tile in `club/PostRoleScreen.tsx:376` (`h-[52px] rounded-[12px]`, Selected = 1.5 px brand border + soft fill + check circle). `OfferSheet.tsx:115` uses `Chips` for the same choice |
| Check item | `467:127` | corrected | `club/FitCard.tsx:19-28` rows | Pass = check in `positive-soft`, Unknown = minus on white / ink-3; no Fail state. Post a role step 3 checklist (`PostRoleScreen.tsx:440`) repeats the pattern |

### Navigation and system

| Component | Node | Verdict | Code counterpart | Props / variants in code · where used |
|---|---|---|---|---|
| Nav bar | `459:2067` | corrected | `ui/DetailNavBar.tsx` | Props `parent`, `title`, `showParent`, `wideParent`, `fallbackPath`, `onBack`, `trailing`; 20 importers. "Cancel" style = `CancelSaveBar` in `profile/mobile/formScreenUi.tsx:9` and the inline header in `club/PostRoleScreen.tsx:259`. "Show text action" = the `trailing` slot |
| Header / Large title | `470:178` | corrected | `ui/LargeTitleBar.tsx` | Props `title`, `trailing` (one 44 px action); 34/41 bold; used by ClubOpportunitiesScreen, InboxPage, OpportunitiesPage |
| Chat header | `460:1887` | corrected | `features/chat-v2/components/ChatHeader.tsx` | Props `participant`, `onBack`, `backLabel`, `profilePath`, `isMobile`, `conversationId`; carries the "…" `MoreMenu`; still on legacy `gray-900` / `purple-600` classes (`:123`) |
| Composer | `460:1905` | corrected | `features/chat-v2/components/Composer.tsx` | Props `value`, `sending`, `disabled`, `onChange`, `onSubmit`, `onFocus`, `maxLength`, `textareaId`; placeholder fixed to "Message"; 40 px send button |
| Tab bar | `98:1118` | confirmed | `components/MobileBottomNav.tsx` | Dot = `bg-hockia-danger`, no numbers; hidden-route list inside; blurs after pointer taps so the global focus ring does not trail |
| Step progress | `472:159` | missing | — | Three bars inline in `club/PostRoleScreen.tsx:271-273` (aria-hidden; "Step n of 3" in the subtitle announces it) |
| Role switcher | `466:5799` | corrected | `club/RankedForSheet.tsx` + inline pill | Pill `ranked-for-pill` in `club/FindPlayersScreen.tsx:134` and `community/ClubViewPlayersHeader.tsx:48`; sheet rows are 64 px radio cards (`RankedForSheet.tsx:40`) |
| System / Status bar, Home indicator | `459:2063`, `459:2066` | n/a | — | Device chrome; code uses safe-area insets |

### Lists and selection

| Component | Node | Verdict | Code counterpart | Props / variants in code · where used |
|---|---|---|---|---|
| List item / Player | `460:1973` | corrected | `club/ScoutPlayerRow.tsx` | Props `row`, `countries`, `meta{kind,text,icon}`, `below`, `trailing`, `onOpen`, `onLongPress`, `testId`; 52 px avatar; used by FindPlayersScreen and ShortlistScreen. Status (Invite / Applied / Invited / Passed) comes from the `trailing` slot through `club/InviteAction.tsx`. Actions sit in a trailing column, not under the content |
| List item / Applicant | `460:2018` | missing | — | Inline row `club/ApplicantsScreen.tsx:128-153`: new dot on the avatar (`:131`), brand "Invited" / "New" text (`:137-138`), grey road tag (`:139`), FitChip + country, right side = days left (`clubReplyLineClass`, amber at ≤ 5 days) or date, ink-4 chevron |
| List item / Menu | `470:168` | corrected | `SettingsRow` in `settings/settingsUi.tsx:57` | Props `title`, `subtitle`, `value`, `icon`, `iconClassName`, `onClick`, `trailing`, `tone`, `chevron`; min-h 50 inside `SettingsGroup`. Action-sheet rows: `safety/MoreMenu.tsx:109` (52 px, destructive = `text-hockia-danger`) |
| List item / Switch | `472:186` | corrected | `SettingsRow` + `SettingsSwitch`, packaged as `ContactEmailPublicRow` (`settingsUi.tsx:76`) | `pages/ConfirmSigningPage.tsx:168` re-implements the row with `border border-line` instead of the grouped fill |
| List item / Career | `468:133` | confirmed (local) | `Entry` in `profile/mobile/CareerScreen.tsx` (not exported) | Team · role / league line · span · highlights; `CareerRow` in `club/ApplicantReviewScreen.tsx` is a second copy |
| Detail row | `467:128` | missing | — | `Row` in `club/OfferSheet.tsx:48` (label / value / chevron, expandable, min-h 44), `pages/ConfirmSigningPage.tsx:161`, `askRow` in `OpportunityDetailMobile.tsx`, `<dl>` facts in `InviteCard.tsx:119` and `OfferCard.tsx:100` (`w-[72px]` / `w-[68px]` label columns) |
| Section header | `467:135` | missing (token form) | — | `h2` + "See all" inline (`club/ApplicantReviewScreen.tsx:455-456`); `Section` in `club/roleFormUi.tsx:26` (form sections with trailing + hint); `home/pulse/SectionHeader.tsx` is the pre-token Pulse version (hex colour, extrabold) |
| Avatar | `460:22` | confirmed | `ui/EntityAvatar.tsx` | Props `src`, `name`, `role`, `size` (any number), `className`; people = circle, organisations = rounded square on white; 30 importers. No "Show new dot" prop (`ApplicantsScreen.tsx:131` draws it). Sizes in use: 26, 44, 48, 52, 56, 80 — Figma lists 32 / 48 / 72 |
| Option card | `460:40` | corrected | `club/InviteSheet.tsx:137-157` and `club/RankedForSheet.tsx:40` (radio cards) | Grouped fill, title + detail, check on Selected; no shared component |
| Field header | `472:180` | corrected | `Section` + `HardnessPill` + `Muted` in `club/roleFormUi.tsx:10-39` | Must have / Nice to have = `HardnessPill` (a switch); Optional = `Muted`; Always required = inline lock + text (`PostRoleScreen.tsx:297`); None = `Section` without `trailing` |
| Video thumbnail | `468:132` | corrected | `profile/mobile/ProfileVideoTile.tsx` | Props `video`, `portrait`, `locked`, `canWatch`, `compact`, `eager`, `priority`, `onOpen`; lock badge via `VideoLockBadge`. Full match vs Highlight is decided by the rail, not a prop |
| Skill item | `468:143` | missing | — | Inline in `club/ApplicantReviewScreen.tsx:470-475` (22 px soft tile + label); editor chips = `components/SpecialistSkillsSelect.tsx` |
| Message / Invitation card | `465:2194` | confirmed | `features/chat-v2/components/InviteCard.tsx` | Props `inviteId`, `opportunityId`, `isMine`, `fallbackText`; eyebrow · title · When · Pay · Package · League · note; mounted by `MessageBubble.tsx:245` behind a 260 px skeleton (height must stay stable). The sibling `OfferCard.tsx` (230 px skeleton) has no Figma component yet (D4 is tokens-only) |
| Icons | `458:83` | confirmed | `lucide-react` | One inline SVG, `components/icons/TikTokIcon.tsx` |

## Open items

Severity: **High** = breaks a decided rule on a shipped screen; **Medium** =
visible inconsistency or accessibility gap; **Low** = token / metric drift.
"Resolution" says who moves: *code* (a code change, no Figma edit), *Figma*
(the component or screen changes), *decision* (founder picks).

| # | Date | From | Item | Answer |
|---|---|---|---|---|
| 1 | 2026-10-02 | code | **D3 · Row action is Primary on every row.** `club/InviteAction.tsx:39` renders "Invite" as `bg-hockia-primary text-white` (Primary) in every Find players and Shortlist row; Figma D3.1 (`393:2`) reads "Invite to apply", Tonal, Small, and decisions.md says one Primary per screen and Tonal for repeated row actions. **High.** Resolution: *code* → Tonal (`bg-hockia-soft text-hockia-primary`); *decision* on the label: "Invite to apply" is about 120 px at 15 px and sits beside the shortlist / message icon buttons in the trailing column (see #2), so either the label stays "Invite" with the full text in `aria-label`, or the row layout changes. Tests `__tests__/d3Invite.test.tsx` and `clubLeaf7.test.tsx` pin the row action and move with it || **Ruled 2026-10-02**: Tonal "Invite" (full "Invite to apply" as the accessible name). Figma List item / Player `460:1973` updated to match. — design |
| 2 | 2026-10-02 | code | **D3 · Row actions under the content vs trailing column.** `club/ScoutPlayerRow.tsx:88` puts the row's actions in a trailing slot and truncates name / role / facts; Figma List item / Player (`460:1973`) puts actions under the content "so text never wraps". **Medium.** Resolution: *decision* — keep the trailing slot in Figma (smaller rows, two actions fit) or restructure the row in code (both screens, two tests) || **Ruled 2026-10-02**: the trailing column stays. Figma List item / Player now puts actions trailing and truncates name, meta and evidence to one line, as in code. — design |
| 3 | 2026-10-02 | code | **D3 · 36 px controls have no 44 pt hit area.** decisions.md records "36 pt visually with 44 pt hit areas in code (padding / hit-slop)", but no hit-slop exists in these files: `club/InviteAction.tsx:39` (h-9), `club/FindPlayersScreen.tsx:178,184` and `club/ShortlistScreen.tsx:160` (h-9 w-9), `club/InviteSheet.tsx:161` "Change role" (~26 px), `InviteCard.tsx:143` "Not interested" (~32 px) and `:158` "View role" (text, no height). **Medium.** Resolution: *code* — add the hit-slop (`before:absolute before:-inset-1` or `min-h-11` wrappers) so the convention is true; then the decision stands | |
| 4 | 2026-10-02 | code | **D3 · Tag sizes and the brand tone.** Neutral pills come in two sizes (`ApplicantsScreen.tsx:139` caption / `px-2 py-0.5` vs `InviteAction.tsx:22-29` secondary / `px-3 py-1.5`), and "Invited" / "New" on the applicant row (`ApplicantsScreen.tsx:137-138`) are plain purple text, not Tag / Brand pills. **Low.** Resolution: *Figma* confirms one Tag size (or adds Small); *code* aligns the three call sites || One Tag size (22 px, `Hockia/Label` 12/16, padding 8). "New" / "Invited" use Tag Brand pills, not plain text. Tag `459:2050` now has Brand, Neutral, Positive, Warning and Gold tones. — design |
| 5 | 2026-10-02 | code | **D3/D4 · Chat card radius 18.** `InviteCard.tsx:61,65,113` and `OfferCard.tsx:38,42,81` use `rounded-[18px]` (the chat bubble radius, `MessageBubble.tsx:364`); the note box inside is 14 (`InviteCard.tsx:128`, `OfferCard.tsx:109`). Tokens after PR #166 are 8 / 12 / 16 / 20. **Low.** Resolution: *decision* — if chat cards follow the bubble, Figma adds a `radius/bubble` 18 token and the Invitation card uses it; otherwise *code* → `rounded-card` 16 and `rounded-md` 12 for the note || **Ruled**: chat cards use radius 16 (`rounded-card`); no new token. Figma cards are already 16. — design |
| 6 | 2026-10-02 | code | **D3 · "Not interested" confirms in a centred modal.** `InviteCard.tsx:164` uses `ConfirmDialog` (centred, `bg-red-600` button, `ConfirmDialog.tsx:88`) while every other D3/D4 confirmation is a bottom sheet (DeclineSheet, OfferCard decline, Withdraw). **Low.** Resolution: *Figma* states the confirmation surface (sheet); *code* swaps to `BottomSheet` with Danger + Tertiary || **Ruled**: Danger confirmations are bottom sheets on the phone (Danger + Tertiary "Keep it"). — design |
| 7 | 2026-10-02 | code | **D3/D4 · Three different danger reds.** `club/DeclineSheet.tsx:112` and the decision bar `ApplicantReviewScreen.tsx:493` use `#e5484d`; `OwnApplicationRoad.tsx:118` and `ConfirmDialog.tsx:88` use `red-600` (= `#b91c1c`, the AA override); `PostRoleScreen.tsx:453,485,497` uses `#dc2626`. Tokens: `status/danger` #dc2626, `danger-strong` #b91c1c. **Low.** Resolution: *code* → `bg-status-danger` / `text-status-danger` everywhere; *Figma* confirms Destructive (soft) text = `status/danger` and Danger (solid) fill = `status/danger` or `danger-strong` | |
| 8 | 2026-10-02 | code | **D3/D4 · Placeholder colour.** `InviteSheet.tsx:186`, `DeclineSheet.tsx:103`, `Composer.tsx:89` and ten more use `placeholder:text-ink-4` (2.2:1); `ClubEditScreen.tsx:44` and `OfferSheet.tsx:135` use `placeholder:text-ink-3`. ink-4 is allowed for placeholders by the token note, but hint text that carries meaning ("Write a short note to …") reads as text. **Low.** Resolution: *Figma* sets the Text field placeholder colour (ink-3 suggested); *code* unifies the 13 call sites | |
| 9 | 2026-10-02 | code | **D4 · "Decline offer" confirms with a Primary button.** `OfferCard.tsx:145` confirms the decline in purple (`bg-hockia-primary`), and the trigger `:117` is Secondary (border), not Destructive (soft). By the rule Destructive → Danger it should be a soft red trigger and a solid red confirm. For the player, declining is a normal choice and the outcome is grey, so the rule may not apply. **High (needs a decision).** Resolution: *decision* — destructive (soft + Danger) or neutral (keep Secondary + Primary); *code* follows || **Ruled**: declining an offer is a neutral choice: grey Secondary trigger and purple Primary confirm. Recorded as an exception in decisions.md. Figma D4.3 already shows Decline as Secondary. — design |
| 10 | 2026-10-02 | code | **D4 · "Withdraw application" is a text link.** `OwnApplicationRoad.tsx:105-113` renders the trigger as `text-ink-2 underline` with no 44 pt height; the confirm `:118` is a solid `red-600` button (Danger, correct). Figma Destructive (soft) is a button. **Medium.** Resolution: *Figma* confirms the player-side trigger style (link vs soft button); *code* gives it 44 pt either way || Player Withdraw trigger = Button Destructive, Small, in the road card (36 px visual, 44 pt hit area); it opens a bottom sheet with Danger "Withdraw" + Tertiary "Keep it". — design |
| 11 | 2026-10-02 | code | **D4 · Two confirmation surfaces on one screen.** On Applicant review the road "…" sheet (`ApplicantReviewScreen.tsx:541-551`) lists destructive items in red text, Decline opens `DeclineSheet` (sheet, solid red "Decline and send"), but Withdraw offer and Undo signing open `ConfirmDialog` (`:583`, centred modal). **Medium.** Resolution: *Figma* states one surface for Danger confirmations (sheet); *code* moves the two `ConfirmDialog` uses to `BottomSheet` || **Ruled**: one surface: bottom sheet for every Danger confirmation (Withdraw offer, Undo signing, Cancel invite). — design |
| 12 | 2026-10-02 | code | **D4 · Text buttons under 44 pt.** `club/RoadToSigningCard.tsx:68` "Message" (text, ~20 px), `SigningPrompt.tsx:16` "Confirm signing" pill (`py-2` ≈ 34 px), `pages/ConfirmSigningPage.tsx:70,130` "My applications" (text), `OwnApplicationRoad.tsx:108` (see #10). `OfferSheet.tsx:51` rows and `OfferCard.tsx:117,120` are 44 ✓. **Medium.** Resolution: *code* — `min-h-11` on each | |
| 13 | 2026-10-02 | code | **D3/D4 · Large button height varies: 50 / 48 / 46 / 44.** 50 px: `InviteSheet.tsx:200`, `OfferSheet.tsx:144`, `MarkSignedSheet.tsx:62`, `ConfirmSigningPage.tsx:176`, `OwnApplicationRoad.tsx:118`, `settingsUi.tsx:93`; 48: road bar `ApplicantReviewScreen.tsx:511-522`; 46: decision bar `:493-495`; 44: `OfferCard.tsx:117`, `InviteCard.tsx:136`, `OwnApplicationRoad.tsx:91`. Figma Large = 48. **Low.** Resolution: *Figma* confirms 48 (and whether in-card buttons are Small 36 or Large); *code* collapses to one height when the shared Button lands || Large = 48 everywhere, including buttons inside chat cards (Invitation / Offer card in Figma use Large). Small = 36. — design |
| 14 | 2026-10-02 | code | **D4 · Amber deadline pill bypasses the tone helpers.** `OfferCard.tsx:91` uses `bg-amber-50 text-amber-700` instead of `STATUS_TONE_PILL.amber` / `status-warning` tokens; the viewer rule itself is correct (`lib/signing.ts` `offerCardState`: amber only for the player). **Low.** Resolution: *code* → `bg-status-warning-soft text-status-warning` | |
| 15 | 2026-10-02 | code | **D4 · Off-token radii in the sheets.** `OfferSheet.tsx:102,103,124` inputs `rounded-[10px]`, `:135` textarea 14; `MarkSignedSheet.tsx:53` checkbox 6; `PostRoleScreen.tsx:376` package tile 12 (= `md`, fine). Tokens are 8 / 12 / 16 / 20. **Low.** Resolution: *Figma* confirms Text field radius (12?) and checkbox radius; *code* → `rounded-tile` / `rounded-md` || Text field radius = `radius/md` 12; checkbox = `radius/sm` 8 (Checkbox row `480:211` updated). — design |
| 16 | 2026-10-02 | code | **D3/D4 · Text sizes outside the Figma scale.** `ConfirmSigningPage.tsx:102` 28 px and `:155` 26 px (scale has title-l 30, title-s 22); `InviteCard.tsx:118` 19 px; `OfferCard.tsx:99` 18 px (scale has title-m 20, headline 16). The rest (22 / 17 / 16 / 15 / 14 / 13 / 12) maps. **Low.** Resolution: *Figma* names the style for the signing titles and the card title; *code* → the matching `--text-*` size || Signing titles (D4.5, D4.6) = `Hockia/Title S` 22/27; chat card title = `Hockia/Title M` 20/25. — design |
| 17 | 2026-10-02 | code | **D4 · Switch row re-implemented.** `ConfirmSigningPage.tsx:168-174` draws the "Stop showing me to other clubs" row with `border border-line` instead of the grouped List item / Switch (`settingsUi.tsx` `SettingsRow` + `SettingsSwitch`). **Low.** Resolution: *code* → `SettingsGroup` + `SettingsRow`, unless Figma D4.5 (`390:936`) intends the outlined card || Grouped List item / Switch (muted fill), as in Figma D4.5 `390:936`. Switch "on" in Figma is now `status/positive` to match `SettingsSwitch`. — design |
| 18 | 2026-10-02 | code | **D4 · Package chosen with two controls.** `OfferSheet.tsx:115` uses `Chips` for the package; Post a role uses the Package option tiles (`PostRoleScreen.tsx:376`). Same choice, two components. **Low.** Resolution: *Figma* says which (D4.2 `390:249` is tokens-only); *code* aligns || Offer sheet shows the terms as Detail rows with a chevron (Figma D4.2 `390:249`); tapping Package opens the same Package option tiles as Post a role. — design |
| 19 | 2026-10-02 | code | **D3/D4 · Textareas inside grouped cards have no visible focus.** `InviteSheet.tsx:186` and `DeclineSheet.tsx:103` set `outline-none` on a transparent textarea inside the grey card, so the global ring (`globals.css:521`) is removed and nothing replaces it; `OfferSheet.tsx:135` and `OfferCard.tsx:142` do show `focus:border-hockia-primary`. **Low.** Resolution: *code* → `focus-within:ring-2 ring-focus-ring` on the card | |
| 20 | 2026-10-02 | code | **D3/D4 · Verified clean.** ink-4 as text: none in D3/D4 (all 22 uses in club / ui / chat / settings are chevrons, placeholders, borders, dividers). Amber: only on viewer-must-act surfaces (`OfferCard`, `ApplicantsScreen` days left, `ChatApplicationCard`). Pronouns: none. Player screens show no counts or fit (`OwnApplicationRoad`, `InviteCard`, `OfferCard`, `ConfirmSigningPage`). One Primary per sheet: InviteSheet, OfferSheet, MarkSignedSheet, DeclineSheet, withdraw sheet, Confirm signing ✓. Info only | |
| 21 | 2026-10-02 | code | **Figma gaps the code side needs filled.** (a) D4 components: Offer card, Offer sheet rows, Road to signing, Mark as signed, Confirm signing have no components (D4 is tokens-only) — when rebuilt, base them on the shipped fields (`lib/signing.ts` `roadSteps`, `offerCardState`, `playerRoadSteps`). (b) Segmented control needs `count` and `dot` properties (in code, used by Inbox and Opportunities). (c) Avatar sizes 52 (rows), 56 (Mark as signed), 80 (Confirm signing) are in code; Figma lists 32 / 48 / 72. (d) Package item types: code has bonuses, equipment, meals, education and no "Paid" or "Other" tile. (e) Tag tones: code has amber / grey / gold (viewer rule), Figma Brand / Neutral / Positive — one of the sets should absorb the other. Resolution: *Figma* || (a) Done in Figma 2026-10-02: Timeline step `480:198` (Done / Current / Upcoming / Skipped, per `roadSteps`), Checkbox row `480:211`, Message / Offer card `480:5154`; D4.1–D4.6 rebuilt. (b) Segmented control item `470:121` has Show dot; counts stay in the label ("Open · 4"). (c) Done: Avatar sizes 32 / 52 / 56 / 80 and Shape Person / Organisation. (d) Done: Package item uses the BENEFIT_TILES set, order and shipped colours (founder ruling); new tokens `accent/cyan-ink`, `accent/indigo-ink`, `accent/red-soft`, `accent/teal-soft-2` are in `figma-export.json`, so `tileClass` can move from raw hex to `bg-accent-*` / `text-accent-*` classes. (e) Tag tones now include Warning (amber) and Gold (trust). — design |
| 22 | 2026-10-02 | code | **Shared Button component.** Twelve of the 36 Figma components have no code counterpart and the biggest one is Button; every D1–D4 button is a class string, which is why #1, #7, #13 exist. Proposal: build `ui/Button.tsx` (Primary · Tonal · Secondary · Tertiary · Link · Destructive · Danger × Large 48 / Small 36, `loading`, 44 pt hit area) as the first step of D2, then migrate D3/D4 call sites. **Needs a decision** on sequencing (Stabilise vs D2) because it touches every shipped sheet. Resolution: *decision* || **Ruled**: shared `ui/Button.tsx` at the start of D5 with the Figma specs (7 styles × Large 48 / Small 36, loading, 44 pt hit area). Figma Button `459:146` already matches. — design |

## Resolved from design (2026-10-03)

- D1.18 Home, "Opportunity posted" card: the "EU passport required" line is removed from Figma. The card stays role · club · city, like the shipped `OpportunityPostedCard.tsx`; requirements live on the role page (amber rule: information is never amber).
