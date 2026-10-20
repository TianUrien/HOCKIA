---
name: hockia-working-backwards
description: Write an internal HOCKIA PR/FAQ (Working Backwards) before designing or building a significant feature or screen change — a short "announcement" of the member benefit plus an FAQ that exposes risks, open questions and what we'd need to prove. Use when the founder is deciding a strategic change (e.g. a new Home, Hockia AI capabilities, club tools), when a feature's value isn't clear yet, or to align design and code agents on why something exists. Internal planning only; never a public press release, never with invented numbers.
---

# HOCKIA Working Backwards (PR/FAQ)

Start from the member's benefit, write it as if it shipped, then let the FAQ try to break it. If the benefit can't be stated simply and honestly, don't design it yet.

## Inputs
- Jobs for the affected roles (`hockia-jobs-to-be-done`) and the evidence in `docs/product/user-research.md`.
- Product rules: `.claude/skills/hockia-design-rules/` (roles, rulings, copy and claims rules: never promise placements, signings or outcomes; no invented metrics).

## Honesty rules
- No statistics, quotes or customer names unless sourced in `user-research.md`. Use placeholders: **[TARGET: …]** for goals we'd set, **[NEEDS EVIDENCE: …]** for claims we can't back yet.
- Any member quote is marked *illustrative* and invented only to show the intended feeling — never presented as real.
- Benefits are what HOCKIA does ("clubs see who is available this week"), not outcomes we can't guarantee ("get signed").

## The PR (one page, plain language)
```
Title: <member benefit in one line>
Subtitle: who it's for and what changes for them
Problem: the job and the pain today (cite evidence or mark [NEEDS EVIDENCE])
Solution: what the member does now, step by step, in their words
How it works: 3–5 bullets, no jargon
Founder quote: why we built it (illustrative is fine — it's ours)
Member quote: *illustrative* — the feeling we want
Get started: where in the app it lives
```

## The FAQ (the important half)
Member FAQ: Who is it for? What does it cost? (free for every role) What happens to my data/privacy? What if I'm a <role> that can't use it?
Internal FAQ:
- Which job does this serve, and which evidence says it matters? What's still a hypothesis?
- What do we stop doing or remove to make room?
- How will we know it worked? (events, targets as [TARGET], how long)
- Risks: privacy and safety (hidden profiles, minors, DOB), trust, bad incentives, empty states with few members, old native clients.
- Effort and dependencies (backend, edge functions, tracking, bundle budget).
- What would make us stop or roll back?
- Cheapest test before building (interviews, prototype, staging experiment).

## Evidence vs assumption table (required)
| Claim in the PR | Evidence (source, date) | Status: evidenced / hypothesis / needs evidence | How to test |

Store PR/FAQs locally or in the founder's docs while they're drafts; only decisions (not the draft) go to `docs/design-handoff/decisions.md`.
