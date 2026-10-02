# Design handoff

The shared contract between design (Figma) and implementation (code). Two
agents work on HOCKIA in parallel, both coordinated by the founder:

- **Design agent**: works in the Figma file "New-Hockia" (components,
  tokens, screens).
- **Code agent**: implements in this repository.

The founder decides priorities and resolves conflicts. Nothing in this folder
overrides a founder ruling.

## Files

| File | Owner | Purpose |
|---|---|---|
| [components.md](components.md) | Design | Figma components: node ids, variants, properties, usage rules, code counterpart |
| [screens.md](screens.md) | Design | Status of each flow in Figma (rebuilt with components / tokens only) |
| [decisions.md](decisions.md) | Both | Decided rulings and open questions |
| [CHANGELOG.md](CHANGELOG.md) | Both | Every edit to the Figma file, newest first |
| [IMPLEMENTATION_FEEDBACK.md](IMPLEMENTATION_FEEDBACK.md) | Code | Constraints, gaps and questions from implementation |

## Protocol

1. **Figma edits**: both agents may edit the Figma file (founder ruling
   2026-10-02). Log every edit in [CHANGELOG.md](CHANGELOG.md) with the date,
   who, what and node ids, so edits don't collide.
2. **Tokens**: Figma variables are the source of truth. To update the code,
   re-export them into `client/src/styles/tokens/figma-export.json` and run
   `npm run tokens:build` (see `client/scripts/build-tokens.mjs`).
   `tailwind.config.js` reads the generated `tokens.js` at build time.
3. **Feedback**: the code agent writes constraints, mismatches and questions
   in [IMPLEMENTATION_FEEDBACK.md](IMPLEMENTATION_FEEDBACK.md). The design
   agent answers in place and moves resolved items to
   [decisions.md](decisions.md).
4. **Screens**: a flow marked "Rebuilt" in [screens.md](screens.md) is the
   reference for implementation. "Tokens only" flows keep their earlier
   layout and are not yet built from components.
5. **Public repository** (ADR 0006): no Figma file key, no real names, no user
   data in this folder. Refer to Figma by file name, page name and node id.

## Where to find things in Figma

- Page **02 · Foundations**: frame "Foundations v2" (`465:1741`) documents
  every colour, text style, spacing and radius value, plus the usage rules.
- Page **03 · Components**: all components, in sections (Icons, Actions,
  Status & feedback, Navigation & system, Lists & selection).
- Flow pages **D1–D6**, **04 · Player — Live**: screens with briefs and dev
  notes. Pages starting with **Archive ·** hold the pre-refinement baselines.
