# Decisions

## Decided

| Date | Decision | By |
|---|---|---|
| 2026-10-05 | Two text styles join the scale to name existing one-offs: Title XL 28 Bold / 34 (screen titles, profile names) and Figure 26 Semibold / 31 (stat numbers). 24 pt sheet names use Title S (22) | Founder |
| 2026-10-04 | D5 Hockia suggests: reason lines are templates filled from profile fields (no free AI text); AI only filters and re-orders in the D5.2 refine chat. Replaces the September "AI-written reasons" ruling | Founder |
| 2026-10-02 | Package tiles keep the shipped colours (Insurance red, Car purple, Visa cyan…); Figma adopts them and the code moves from raw hex to tokens | Founder |
| 2026-10-02 | Avatar sizes follow code: 32 headers, 52 rows, 56 cards and sheets, 80 page crests; organisations are rounded squares on white | Design, matches EntityAvatar |
| 2026-10-02 | Player row: Tonal "Invite" in a trailing column; text truncates to one line ("Invite to apply" is the accessible name) | Founder |
| 2026-10-02 | Exception to the Destructive rule: declining an offer is a neutral choice — grey Secondary trigger, purple Primary confirm | Founder |
| 2026-10-03 | Same exception for a player passing on an invitation ("Not interested", D3.3b): grey text trigger, purple Primary confirm in a bottom sheet, never Danger | Founder |
| 2026-10-02 | Every Danger confirmation on the phone is a bottom sheet (no centred dialogs) | Founder |
| 2026-10-02 | Chat cards use radius 16, no new token | Founder |
| 2026-10-02 | Shared `ui/Button.tsx` at the start of D5: 7 styles × Large 48 / Small 36, loading, 44 pt hit area | Founder |
| 2026-10-02 | Figma variables are the source of truth for colour, spacing, radius and type; code reads them through generated tokens (PR #166) | Founder |
| 2026-10-02 | Radius follows Figma: card 16, sheet 20, tile 8 (was 14 / 22 / 7) | Founder |
| 2026-10-02 | Both agents may edit the Figma file; every edit is logged in CHANGELOG.md | Founder |
| 2026-10-02 | Button hierarchy: one Primary per screen; Tonal for repeated row actions; Destructive (soft) → Danger (solid) confirmation | Design, matches the existing "purple once per screen" rule |
| 2026-09-25 | Fonts: Inter on the web, the system font in the native apps | Founder |
| 2026-10-02 | Typography: Figma SF Pro text styles are the spec; the Tailwind fontSize scale is the implementation (Inter on web, system font native, per the 2026-09-25 ruling) | Founder ruling, confirmed by the code agent |
| 2026-10-02 | Small button, Muted icon button and Chip are 36 pt visually with 44 pt hit areas in code (padding / hit-slop): a documented convention, not a code change | Existing code convention |
| earlier | Colour semantics: amber only when the viewer must act soon; closed outcomes grey; trust = gold; players see "Not selected", never "Declined"; players never see counts, scores, levels or reply times | Founder (enforced in `lib/statusTone.ts`, `lib/applicationStatus.ts`, `lib/opportunityCopy.ts`) |

## Open

None right now. New questions go in IMPLEMENTATION_FEEDBACK.md first.
