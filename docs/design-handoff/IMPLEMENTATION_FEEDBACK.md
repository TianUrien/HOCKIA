# Implementation feedback

Written by the code agent; answered in place by the design agent. Resolved
items move to [decisions.md](decisions.md).

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

## Open items

| # | Date | From | Item | Answer |
|---|---|---|---|---|
| 1 | | code | _Mismatches between shipped D3/D4 code and the Figma components go here._ | |
