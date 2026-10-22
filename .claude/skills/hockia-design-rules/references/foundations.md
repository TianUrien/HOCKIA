# Foundations: colour, type, spacing, radius, finish

Figma variables are the source of truth (decided 2026-10-02); code reads them through generated tokens (`client/src/styles/tokens/figma-export.json` → `npm run tokens:build` → Tailwind). Values below are a snapshot (2026-10-16); if Figma differs, Figma wins.

## Colour

| Token | Light | Use |
|---|---|---|
| brand/primary | #6C2BD9 | the only brand accent: Primary buttons, links, selected text |
| brand/primary-hover · -pressed | #5B21B6 · #4C1D95 | |
| brand/soft · soft-hover | #F1EAFD · #E6DAFB | selected chips, tonal buttons, "To review" tiles, AI surfaces |
| ink/primary · secondary · tertiary · quaternary | #0F0F14 · #5B5B6B · #6F6F7C · #AEAEB2 | quaternary = grabbers, empty checkboxes, disabled |
| ink/inverse | #FFFFFF | text on violet / dark / photos |
| surface/base · subtle · muted · inverse | #FFFFFF · #F8F8FA · #F4F4F7 · #0F0F14 | |
| line/default | #E6E6EC | hairlines 0.5–1 pt |
| status/positive (+soft) | #15803D (#E8F7EE) | success, "Strong fit", "Filled through HOCKIA" |
| status/warning (+soft) | #B45309 (#FDF1E4) | ONLY when the viewer must act |
| status/danger (+soft) | #DC2626 (#FDECEC) | destructive / danger |
| accent/gold (+soft) | #C9A227 (#FFF8DC) | trust: references |
| role/player · coach · club · brand (bg/ink) | blue · teal · orange · rose | role badges, no-photo face gradients |
| category/women (+soft) | #BE123C; dark #FB7185 (#FFE4E9; dark #4C0519) | category chips, dots, Team fact only |
| category/men (+soft) | #0369A1; dark #38BDF8 (#E0F2FE; dark #082F49) | |
| category/mixed (+soft) | #6C2BD9; dark #A78BFA (#F1EAFD; dark #2E1065) | |
| EU badge | #003399 text on #E6EDFF (light surfaces); white on #003399 at 85 % (over photos) | radius 6; tokens `eu/ink`, `eu/soft`, `eu/solid` (2026-10-21); code: `<EuBadge surface="light" \| "photo">` |
| Package tiles | shipped colours (Insurance red, Car purple, Visa cyan…) | decided 2026-10-02; code moves from raw hex to tokens |

Dark mode: the Color collection has Light and Dark modes; category tokens are tuned for dark, most others still mirror Light: tune and check before shipping dark surfaces.

## Type

Fonts: Inter on the web, the system font in the native apps; Figma specs in SF Pro (decided 2026-09-25 / 2026-10-02).
Scale (size / line height): Display 34/41 Bold · Title L 30/36 · Title XL 28/34 (screen titles, profile names) · Title S 22/27 (sheet titles) · Section Title 20/24 Semibold · Headline L 17/22 · Headline 16/21 · Headline S 15/20 · Body L 17/22 · Body 16/22 · Body M 15/20 · Body S 14/19 (+ Strong) · Footnote 13/18 (+ Strong) · Caption 12/16 · Label 12/16 Semibold · Overline 12/16 Semibold caps · Micro 11/14 Semibold caps · Figure 26/31 Semibold (stat numbers).
Chip labels ≥ 12 pt. Tabular numbers for counts and pipelines.

## Spacing

space: 2 4 6 8 12 16 20 24 32 40 48 64. Screen side padding 16; section gaps 24–28 on phones, 36 on desktop.

## Radius

| Element | Radius | Ruling |
|---|---|---|
| Bottom sheets (all) | 28 | 2026-10-11, supersedes 20 |
| Large cards (featured, role cards, covers) | 24 | redesign 2026-10-11 |
| Person tiles, list rows, result cards | 20 | redesign |
| Facts / small tiles | 12 | redesign |
| Chat cards | 16 | 2026-10-02 |
| Legacy component cards / tiles not yet rebuilt | 16 / 8 | 2026-10-02 |
| Pills, chips, buttons | fully round | |
| Organisation avatars | rounded square on white | |
Large surfaces use corner smoothing 0.6 (squircle; in code a small in-house helper: `clip-path` kills shadows, so crest tiles use plain radius + two-layer shadow).

## Elevation and finish ("premium pass", approved)

- Hairlines 0.5 pt; inside white tiles 8–10 % ink.
- Shadows layered and slightly violet-tinted (e.g. 0 4 16 rgba(41,16,96,.06)); never harsh black.
- Photo scrims: eased multi-stop gradients (≈ 7 stops), dark at the bottom for white text.
- Glass: background blur 16–24 + a 1 pt top highlight (white ~20 %) on chips, close/more buttons and bars over photos.
- Never place dark text directly on a busy photo; use a scrim or glass.
- Avoid solid violet tiles inside photo mosaics; a "+7" overflow tile is the next photo blurred with a ~42 % dark veil and white "+7".
