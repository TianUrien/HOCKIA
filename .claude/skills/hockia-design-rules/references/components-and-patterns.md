# Components and patterns

Component anatomy lives in the Figma file "New-Hockia", page "03 · Components" (node ids in `docs/design-handoff/components.md`). Reuse them; add to that doc when something new is approved.

## Buttons
- Styles: Primary (solid violet), Tonal (soft violet; repeated row actions), Secondary (outlined, equal-weight alternative), Tertiary (neutral text), Link (violet inline), Destructive (soft red; opens a negative action), Danger (solid red; confirms it).
- Sizes: action-bar Primary 52; Large 48; Small 36 with 44 hit area. Icon buttons: Muted 36, Tonal 36, Ghost 44, Glass 36 (over photos).
- **One Primary per screen, sheet or card.** On own profiles "Edit profile" is Secondary.
- Exceptions to Destructive: declining an offer or passing on an invitation is a neutral choice (grey trigger, violet Primary confirm), never Danger.
- Every Danger confirmation on phones is a bottom sheet, never a centred dialog.
- Shared implementation: `ui/Button.tsx` (7 styles × Large/Small, loading, 44 hit).

## Chips, tags, segments
- Chip (filters, single choice): selected = brand/soft fill + brand/primary text; unselected = outline. 32–36 visual, 44 hit. A "Filters" chip can lead the quick-filter row.
- Category chip: soft fill + dot in the category hue (adult); outline in the same hue (Girls/Boys).
- Tag: Brand (New, Invited, audience), Neutral (passive states, "Applied"), Positive, Warning, Gold. Tags are not tappable.
- Meta tag (identity facts under a name: club, position, specialist skill): Neutral/Brand.
- Segmented control: 2–4 mutually exclusive segments; counts in the label ("Open roles · 15").
- Glass chips over photos (category, status) use blur + top highlight.

## Status, feedback, attention
- Banner: tappable attention item at the top of a screen; Warning only when the viewer must act soon (e.g. "4 applicants waiting for a reply").
- Callout: one explanatory note per screen, at the end of the content.
- Toasts: bottom of the screen on phones; undo where an action is reversible.
- Fit badge (club/recruiter only): Strong / Possible with a bar meter so meaning never relies on colour; never shown to players, never for under-18s.
- Stat (pipeline counts, recruiters only): big Figure numbers; "To review" in brand tone when > 0.

## Sheets and overlays
- Bottom sheets radius 28, grabber, detents (medium / large); content behind scales to 0.94 at the large detent.
- Danger confirmations, pickers and secondary flows open as sheets on phones.
- Full-screen previews (member deck, media viewer) close by swipe down.

## Lists and rows
- Rows: 48 pt minimum; text truncates to one line with the action in a trailing column (player rows: Tonal "Invite").
- Applicant rows: Warning tone at ≤ 5 days left; a violet "New" dot until viewed.
- Conversation rows: amber dot only when the viewer owes a first reply; tab bar Inbox uses a red dot without numbers.
- Avatars: 32 headers, 40 feed author, 52 rows, 56 cards/sheets, 80 page crests; people = circle, organisations = rounded square on white.

## Forms
- Text field: muted fill at rest, white with brand border on focus.
- Field header shows the requirement (Must have, Nice to have, Always required, Optional); "Add · optional" in brand; amber only if required and missing.
- Edit flows: a row list → one sheet per field → Save per field (current mobile pattern).
- Location: Google Places autocomplete (English names), city + country; free text fallback if Places is unavailable.

## States every screen needs
- **Loading:** skeletons shaped like the content (no spinners on full screens); images blur up from a small LQIP.
- **Empty:** says what will appear and how to make it happen, with one action; no fake activity; owner vs visitor copy differs; public views hide empty sections.
- **Error:** what went wrong + what to do ("Try again"); keep user input; never blame the user.
- **No photo:** role/club treatments (see covers-and-crests.md), never a grey silhouette.
- **Signed out:** CTAs lead to a join prompt.
