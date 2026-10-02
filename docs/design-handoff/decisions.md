# Decisions

## Decided

| Date | Decision | By |
|---|---|---|
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
