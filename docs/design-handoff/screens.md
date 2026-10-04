# Screens in Figma

Status as of 2026-10-02. "Rebuilt" means the screen is assembled from the
components in [components.md](components.md), with all prototype links kept.
"Tokens only" means colours and text styles are bound to the Foundations
tokens but the layout is still built from one-off frames.

| Flow (Figma page) | Screens | Status | Baseline |
|---|---|---|---|
| D3 · Core — Invite to apply | D3.1–D3.4 + D3.3b (`393:2`, `393:178`, `393:351`, `393:452`, `496:1448`) | Rebuilt | Archive · D3 baseline |
| D1 · Club v2 — Recruiting | D1.1–D1.10 (`324:264`, `324:411`, `326:319`, `327:318`, `326:528`, `330:318`, `330:431`, `330:596`, `332:318`, `332:539`) | Rebuilt | Archive · D1 Recruiting baseline |
| D1 · Club v2 — Profile | D1.11–D1.15 (`337:372`, `337:588`, `338:424`, `338:495`, `338:575`) | Rebuilt | Archive · D1 Profile & Network baseline |
| D1 · Club v2 — Network & tabs | D1.16–D1.23 (`352:450`, `352:995`, `352:1290`, `353:502`, `353:718`, `353:809`, `353:893`, `355:528`) | Rebuilt | Archive · D1 Profile & Network baseline |
| D2 · Core — 30-second profile | D2.1–D2.4 (`395:83`, `395:333`, `395:563`, `395:601`) | Rebuilt (matches shipped) | — |
| D4 · Core — From yes to signed | D4.1–D4.6 (`390:3`, `390:249`, `390:557`, `390:647`, `390:936`, `390:980`) | Rebuilt | Archive · D4 baseline |
| D5 · Core — Hockia suggests | D5.1–D5.2 (`398:83`, `398:291`) | Rebuilt | — |
| D6 · Coach v2 | D6.1–D6.4 (`377:186`, `377:614`, `377:1430`, `377:1814`) | Rebuilt | — |
| 04 · Player — Live | about 75 screens (older v2 frames marked "[Superseded → …]") | On components (audited 2026-10-05); remaining one-offs listed in CHANGELOG | — |

## Notes on the rebuilt flows

- D3.1 row action reads **"Invite"** (Tonal, Small, trailing; founder ruling). Players who
  already applied show a neutral **Applied** tag instead.
- D1.5 decline: soft **Decline** in the decision bar opens the sheet; the
  sheet confirms with a solid **Danger** "Decline and send".
- D1.6–D1.8 (Post a role) use Field header + control + helper caption, a
  3-step progress bar and a sticky bottom bar with one Primary button.
- D3.3b "Not interested" is neutral (founder ruling, like Decline offer):
  grey text trigger on the card, purple Primary confirm in a bottom sheet.
- D1.18 Home: every feed item is an instance of a Feed component named after
  its code card (`components/home/cards`).
