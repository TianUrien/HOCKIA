# Figma changelog

Every edit to the Figma file "New-Hockia", newest first. Format:
`date · who · what · node ids`.

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
