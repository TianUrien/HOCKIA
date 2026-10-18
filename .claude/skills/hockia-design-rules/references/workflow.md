# Figma files, handoff and review workflow

## Figma
- **"New-Hockia"** — the design system file: tokens, components (page "03 · Components"), rebuilt screens. Node ids in `docs/design-handoff/components.md` and `screens.md`.
- **"New Hockia 2 · Draft"** — the redesign lab (Community, Home, Profile, Opportunities, Hockia AI, Nationality pages with handoff spec boards). Refer to files by name, page and node id only (public repo: no file keys or links here).
- Before writing to Figma: load the Figma skills (`figma:figma-use` before `use_figma`), search existing components and variables first, bind variables (no hard-coded values), reflow at real sizes (never `rescale()` device variants), verify with screenshots.
- Both agents may edit the Figma file; log edits in `docs/design-handoff/CHANGELOG.md`.

## From idea to production
1. Read this skill and the relevant code (statuses, copy helpers, data model, existing components) so the design matches reality.
2. Design phone first, then Android and desktop; check dark mode, empty/loading/error states.
3. Show the founder composites or a tappable prototype; ask with 2–4 options, recommended first.
4. After approval, hand off: Figma spec boards + a text spec (local, gitignored `client/test-results/handoff/`) to the code agent. Sending a handoff is not a build go: the code agent confirms scope and go with the founder.
5. The code agent ships to **staging** with device-lab screenshots (`docs/engineering/device-lab.md`); the founder approves; the founder merges `staging → main`. Never push to `main`.
6. Deviations: decide with the founder, then update Figma and `docs/design-handoff/decisions.md` so design and code don't drift. The code agent records constraints in `docs/design-handoff/IMPLEMENTATION_FEEDBACK.md`.

## Engineering constraints that shape design
- Bundle budgets: `docs/engineering/standards.md` §2 (first-load 560 KB gzip since 2026-10-07; raw 5,400 KB since 2026-10-18; either is raised only with founder approval). ADR 0004 point 1 ("480 KB, never raised") is superseded.
- New public tables/columns: explicit grants; `profiles` uses column-level SELECT grants (`CLAUDE.md`).
- Hidden-profile predicate on every new surface that returns people.
- Old native clients: additive, nullable changes; gate breaking ones on `min_version`.
- No new paid services without a founder decision.

## Keeping this skill current
When the founder makes a new ruling: add it here (with the date) **and** to `docs/design-handoff/decisions.md` in the same PR as the change it describes. Remove superseded rules rather than leaving both. No names, keys or private links (ADR 0006).
