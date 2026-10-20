---
name: hockia-design-rules
description: HOCKIA's own design rules, the founder's standing rulings for the HOCKIA field hockey networking app (iOS, Android, tablet, web/desktop). Use this whenever you design, review, critique, write copy for or implement ANY HOCKIA screen, component, state, email or visual. Figma work, UI code in client/src, design handoffs between the design agent and code agents, staging/device-lab reviews, or marketing visuals that show the app. Covers precedence of sources, colour/type/spacing/radius tokens, buttons/chips/sheets/tags patterns, category colours (Women's/Men's/Mixed/Girls/Boys), club-crest cover palettes, nationality and EU display, motion springs and haptics, copy and claims rules, privacy/safety/minors rules, platform rules (phone, Android, tablet, desktop, dark mode, accessibility), field hockey accuracy, and product rulings for Community, Home, Profile, Opportunities, Inbox and the Hockia AI mascot chat. Trigger even when the user doesn't say "rules", e.g. "design the club page", "add a filter chip", "review this staging screenshot", "build the role card", "write the empty state", "what colour for women's roles", "make this more premium", if it touches HOCKIA UI, load this first so you apply decisions the founder already made instead of re-litigating them.
---

# HOCKIA design rules

HOCKIA is a networking app for field hockey: players, coaches, clubs, umpires and brands. The founder has made many explicit design and product rulings. This skill is the digest of those rulings so every session applies them instead of rediscovering or contradicting them. It complements, and never overrides, `CLAUDE.md`, `docs/engineering/` and `docs/design-handoff/`.

## Precedence (when sources disagree)

1. A founder ruling given in the current conversation.
2. The newest dated founder ruling in writing: `docs/design-handoff/decisions.md`, ADRs in `docs/engineering/decisions/`, this skill (each rule here carries its date where it matters).
3. `CLAUDE.md` and `docs/engineering/*.md` (engineering constraints: grants, hidden-profile fences, bundle budgets, native clients).
4. Figma variables and components (source of truth for tokens and component anatomy).
5. Your own taste, last. If you think a rule is wrong, say so and ask; don't deviate silently.

When code and design disagree, decide with the founder, then update both the losing side and `docs/design-handoff/decisions.md` so they don't drift.

## How to use this skill

Read the core rules below, then open only the reference you need:

| You're working on | Read |
|---|---|
| Colour, type, spacing, radii, elevation, finish | `references/foundations.md` |
| Buttons, chips, tags, sheets, banners, lists, forms, empty/loading/error states | `references/components-and-patterns.md` |
| Covers, crest colours, generated backgrounds, photos, imagery | `references/covers-and-crests.md` |
| Motion, springs, gestures, haptics | `references/motion-and-haptics.md` |
| Copy, labels, claims, privacy, safety, minors | `references/copy-privacy-safety.md` |
| What HOCKIA is for, each role (player, coach, club, umpire, brand): who, goals, capabilities, limits | `references/roles-and-product.md` |
| A product area (Community, Home, Profile, Opportunities, Inbox, Hockia AI, nationality, location) | `references/product-rulings.md` |
| iOS, Android, tablet, desktop, dark mode, accessibility | `references/platforms.md` |
| Field hockey facts, roles, categories, vocabulary | `references/hockey-domain.md` |
| Figma files, handoff protocol, who builds what, review flow, customer-obsession checks | `references/workflow.md` |

## Core rules (apply everywhere)

- **One brand accent.** HOCKIA violet `brand/primary` #6C2BD9. One solid-violet Primary per screen, sheet or card; everything else is Tonal, Secondary, Tertiary or Link. No loud solid violet blocks as decoration (e.g. inside photo mosaics).
- **Tokens only.** Colours, spacing, radii and type come from Figma variables / generated Tailwind tokens. No raw hex in components.
- **Selected chip = soft violet** (brand/soft fill + brand/primary text), never solid black or solid violet (2026-10-05). Earlier Figma explorations with ink-black selected chips are superseded.
- **Category colour is information.** Women's ruby #BE123C, Men's ocean #0369A1, Mixed violet #6C2BD9; Girls/Boys = outline chip in the women's/men's hue (2026-10-16, supersedes the 2026-10-05 all-soft-purple team tags). Category colour only appears in category chips, filter dots and the "Team" fact, never as a card or cover background.
- **Covers use the club's own colours** read from its crest (2026-10-16). No crest → HOCKIA violet. Never a grey placeholder.
- **Nationality is critical.** On a person, a flag always means nationality (passport), never location. Show both nationalities when they exist + an "EU" badge when either is EU; location is text ("Based in <city>, <country>"); never truncate the second nationality (2026-10-16). Club and brand flags mean their country.
- **Amber only when the viewer must act** (a reply owed, ≤ 5 days left). Closed outcomes grey; trust (references) gold; success green.
- **Sizes.** Every tap target ≥ 44 pt. Primary in sticky action bars 52 pt; Button Large 48, Small 36 (44 hit). Bottom sheets radius 28 everywhere (2026-10-11).
- **Copy** is English, sentence case, gender-neutral (name or "they"), plain and specific. Never promise outcomes (placements, signings, guarantees, rankings, "accurate AI"); never invent metrics, percentages or counts; label sample data as illustrative.
- **Players never see** fit scores, counts of other applicants, levels, rankings or reply-time estimates; players see "Not selected", never "Declined".
- **No Save/bookmark surfaces** for players (2026-09-20). **No activity / last-seen signals** on profiles, cards or Community (2026-10-12); only the chat header may show activity, and only if the user allows it.
- **Privacy & safety.** Every list, count, summary or AI read of people respects hidden profiles (blocked or frozen minors). Date of birth is owner-only (others see age). Never accept photos of ID documents. AI never judges or compares people by age, gender, nationality or appearance.
- **Respect what exists.** Reuse the status words, enums and copy helpers already in code (`lib/applicationStatus.ts`, `lib/opportunityCopy.ts`, `lib/statusTone.ts`, …) and existing components before inventing new ones. Flag anything that needs backend.
- **Field hockey, never ice hockey;** pitches have no centre circle; sticks are right-handed and the ball is played with the flat face.
- **Customer obsession.** Every screen change answers: what did the member come to get, and how does this help? Separate evidence, hypotheses and gaps; never invent research or metrics (`references/workflow.md`, `docs/product/user-research.md`).
- **Product priority.** Clubs first; free for every role (no paywalls or upsells); umpires profile-only; under-18s waitlist only (2026-10-16). Roles: `references/roles-and-product.md`.
- **Platforms.** Phone first (393 × 852), then Android (412 × 915) and desktop (≥ 1024, content max 1200). Native tablets get the phone layout (ADR 0008). Light first; check dark mode before handoff.

## Working with the founder

- Ask before materially different creative directions; give 2–4 concrete options with the recommended one first. Don't ask about routine edits.
- Confirm a build go explicitly, never relay an ambiguous one-word reply to a code agent as approval.
- Staging first; never push to `main`; the founder approves PRs from device-lab screenshots and merges `staging → main`.
- This repository is public (ADR 0006): no Figma file keys, people's names, user data or private links in committed files.
