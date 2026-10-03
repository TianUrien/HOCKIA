# Components (Figma page "03 · Components")

Node ids refer to the Figma file "New-Hockia". Every component also carries
its usage rules in its Figma description. "Code counterpart" is the best
current match in `client/src/components/`; the code agent confirms or
corrects it in [IMPLEMENTATION_FEEDBACK.md](IMPLEMENTATION_FEEDBACK.md).

## Actions

| Component | Node | Variants / properties | Usage | Code counterpart (to confirm) |
|---|---|---|---|---|
| Button | `459:146` | Style: Primary, Tonal, Secondary, Tertiary, Link, Destructive, Danger · Size: Large 48, Small 36 · State: Default, Hover, Pressed, Focus, Disabled, Loading · Label, Show icon, Icon | One Primary per screen, sheet or card. Tonal for actions repeated in rows. Secondary = equal-weight alternative. Tertiary = neutral low-emphasis text. Link = brand inline text. Destructive (soft) opens a negative action; Danger (solid) confirms it | — |
| Icon button | `459:171` | Style: Muted 36, Tonal 36, Ghost 44, Glass 36 · State · Icon | Muted for secondary row actions, Tonal for a selected toggle, Ghost in nav bars | — |
| Chip | `459:184` | Selected · State · Label | Filters and single-choice options | — |
| Segmented control | `470:122` (item `470:121`) | 2–4 segments, Selected per segment | Mutually exclusive options | `ui/SegmentedControl.tsx` |
| Switch | `472:185` | On | iOS-style on/off | `SettingsSwitch` in `settings/settingsUi.tsx` |
| Text field | `472:243` | Type: Input, Select, Text area · State: Default, Focus, Disabled · Value, Leading icon | Muted fill at rest, white with brand border on focus | — |

## Status and feedback

| Component | Node | Variants / properties | Usage | Code counterpart |
|---|---|---|---|---|
| Tag | `459:2050` | Tone: Brand, Neutral, Positive, Warning, Gold · Label | New / Invited / audience labels (Brand), passive states (Neutral) | — |
| Fit badge | `459:2043` | Fit: Strong, Possible | Club-only. Bar meter so meaning never relies on colour | `club/FitCard.tsx` (related) |
| Callout | `460:23` | Text, Icon | One explanatory note per screen, at the end of the content | — |
| Banner | `470:160` | Tone: Warning, Info, Positive · Title, Message, Show chevron | Tappable attention item at the top of a screen. Warning only when the viewer must act soon | — |
| Stat | `470:167` | Emphasis · Value, Label | Pipeline counts (club only) | — |
| Package item | `470:1660` | Type: Paid, Housing, Flights, Job, Insurance, Bonuses, Visa, Car, Equipment, Meals, Education · Label | Code order and colours (`lib/opportunityCopy.ts` BENEFIT_TILES) | — |
| Package option | `472:260` | Selected | Multi-select tile in forms | — |
| Check item | `467:127` | State: Pass, Unknown, Fail · Title, Detail | Explainable checks (fit criteria, readiness) | — |

## Navigation and system

| Component | Node | Variants / properties | Usage | Code counterpart |
|---|---|---|---|---|
| Nav bar | `459:2067` | Back label, Show action, Show text action, Show title, Title | Pushed screens. "Cancel" style = hide the nested back chevron | — |
| Header / Large title | `470:178` | Title, Show action | Root tab headers | — |
| Chat header | `460:1887` | Back label, Name, Subtitle | Conversations | — |
| Composer | `460:1905` | Placeholder | Message input bar | — |
| Tab bar | `98:1118` | Active, Inbox unread | Primary navigation, red dot without numbers | `MobileBottomNav.tsx` |
| Step progress | `472:159` | Current: 1–3 | Multi-step flows | — |
| Role switcher | `466:5799` | Role | "Ranked for" role picker | — |
| System / Status bar, Home indicator | `507:397`, `459:2066` | Appearance: Dark, Light | Figma-only device chrome | — |

## Lists and selection

| Component | Node | Variants / properties | Usage | Code counterpart |
|---|---|---|---|---|
| List item / Player | `460:1973` | Status: Invite, Applied, Saved, Scout · Name, Meta, Country, Evidence, Note, Show applied tag | Shortlist and Find players rows; actions in a trailing column, text truncates to one line (founder ruling) | — |
| List item / Applicant | `460:2018` | Urgency: Default, Warning · Name, Meta, Country, Deadline, Show tag | Review queue; Warning at ≤ 5 days left | — |
| List item / Menu | `470:168` | Label, Value, Icon | Rows inside a grouped card | — |
| List item / Switch | `472:186` | Title, Description | Setting with a switch | `SettingsSwitch` in `settings/settingsUi.tsx` |
| List item / Career | `468:133` | Team, Role, When, Achievement | Career entries | `profile/mobile/CareerScreen.tsx` |
| Detail row | `467:128` | Label, Value, Show leading | Facts tables | — |
| Section header | `467:135` | Title, Show action | Section headings with "See all" | — |
| Avatar | `460:22` | Size: 32, 40, 52, 56, 80 · Shape: Person, Organisation · Show new dot | People (circle) and clubs (rounded square on white) | `ui/EntityAvatar.tsx` |
| Option card | `460:40` | Selected · Title, Detail, Show icon, Icon | Single choice (role picker) | — |
| Field header | `472:180` | Requirement: Must have, Nice to have, Always required, Optional, None | Form labels with the matching rule | — |
| Video thumbnail | `468:132` | Type: Full match, Highlight | Video rails | — |
| Skill item | `468:143` | Label | Specialist skills | — |
| Timeline step | `480:198` | State: Done, Current, Upcoming, Skipped · Title, Detail, Show action | Road to signing (`lib/signing.ts` roadSteps): trial never Current; skipped offer = grey dash | `club/RoadToSigningCard.tsx` |
| Checkbox row | `480:211` | Checked · Title, Description | Optional side effect in a confirm sheet (Close the role) | `club/MarkSignedSheet.tsx` |
| List item / Conversation | `494:2377` | Dot: None, Warning · Name, Date, Meta, Preview | Inbox thread rows; amber dot only when the viewer owes a first reply | — |
| Message / Offer card | `480:5154` | Eyebrow, Title, Start, Pay, Package, Open until, Footnote | Offer in a conversation; deadline amber only for the player in the last 5 days | `features/chat-v2/components/OfferCard.tsx` (keep height stable) |
| Message / Invitation card | `465:2194` | Eyebrow, Title, When, Pay, Package, League, Message | Invitation in a conversation | `features/chat-v2/components/InviteCard.tsx` (keep height stable) |

## Feed and cards

| Component | Node | Variants / properties | Usage | Code counterpart |
|---|---|---|---|---|
| Feed / Header | `503:241` | Trailing: More, Badge · Headline, Meta, Badge icon | Author row of every feed item; avatar 40 | `home/FeedCard.tsx` `FeedCardHeader` |
| Feed / Interaction bar | `503:274` | Type: Post, Question · Likes, Comments | Like, comment, share; Question adds Answer | `home/PostInteractionBar.tsx` |
| Feed / Action | `503:246` | Style: Neutral, Primary · Label | Pill actions in a feed item | `FeedCardAction`, `FeedCardPrimaryAction` |
| Feed / <type> (11) | section `503:218` | — | One per item type | `home/cards/*Card.tsx` |
| Card / Your week | `505:3148` | Value 1–3, Label 1–3 | Home summary card | `home/YourWeekCard.tsx` |
| Card / Member | `501:6648` | Name, Meta, Country, Show open to play, Show fit | Community grid card; fit is club-only | — |
| List item / Conversation | `494:2377` | Dot: None, Warning · Name, Date, Meta, Preview | Inbox rows; amber dot only when a first reply is owed | — |

## Player screens (Pulse, Hockia AI, onboarding)

| Component | Node | Variants / properties | Usage | Code counterpart |
|---|---|---|---|---|
| Card / Check-in | `532:434` | Views: Some, None · Views line, Question, Detail | Top of Your week | `pulse/CheckInCard.tsx` |
| Card / Week tile | `531:427` | Delta: Up, None · Value, Label, Detail | 2×2 numbers | `pulse/WeekTiles.tsx` |
| Card / Viewer | `531:445` | Hidden: False, True · Name, Meta | Who looked at you rail | `pulse/WhoLookedAtYou.tsx` |
| Card / First this week | `532:450` | Title, Detail, Body, Action | A first this week | — |
| Card / Reference ask | `532:461` | Title, Detail, Action | New friend can write a reference | — |
| List item / Activity | `531:469` | Leading: Avatar, Icon · Text, When, Icon | What happened (all grey) | `pulse/WhatHappened.tsx` |
| List item / Role result | `534:2448` | Title, Meta | Roles inside a Hockia AI answer | discover result cards |
| List item / Member result | `521:387` | Name, Meta, Flag, Show flag | Search rows | `search/SearchV2Screen.tsx` |
| Role badge | `518:7691` | Role: Player, Coach, Club, Brand, Umpire | Member role pill | `RoleBadge.tsx` |
| Button / Social | `535:8381` | Provider: Apple, Google · Label | Sign in with Apple / Google | auth screens |

## Icons

34 icon components (`Icon/*`, section "Icons", `458:83`). In code, icons come
from `lucide-react` or inline SVG only; map each Figma icon to its lucide
equivalent rather than adding a library.
