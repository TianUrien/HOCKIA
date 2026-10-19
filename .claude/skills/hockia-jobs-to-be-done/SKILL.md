---
name: hockia-jobs-to-be-done
description: Define what HOCKIA members come to get done (Jobs to Be Done) for a role, a screen or a feature, with every job, pain and gain tagged as evidence or hypothesis. Use before redesigning or adding a HOCKIA screen (Home, Opportunities, Community, Profile, Inbox, Hockia AI), when deciding a screen's primary action or the order of its sections, when the founder asks "what does the user want here?", or when a proposal needs to justify why a section exists. Not for writing marketing copy.
---

# HOCKIA Jobs to Be Done

A member doesn't want a feed, a card or a chat. They want progress in their hockey life: a club, a player, a reply, a signing, a sponsor. This skill turns "what should this screen be?" into "what job did the member hire HOCKIA to do here, and does this screen do it?"

## Inputs to read first
- `.claude/skills/hockia-design-rules/references/roles-and-product.md` — roles, promises, what each can and can't do, the recruiting loop (North Star), strategic rulings.
- `docs/product/user-research.md` — evidence, hypotheses, gaps. Only cite what is there (or new evidence the founder provides in the conversation, with its source).
- The screen as shipped (code on `staging`, Figma) — what it actually offers today.

## Evidence rules (non-negotiable)
- Tag every job, pain, gain and situation as **[Evidence: source, date]** or **[Hypothesis]**.
- If no research is supplied, the whole output is a hypothesis map — say so at the top.
- No numbers, percentages, quotes or "users say" unless they come from a cited source. Write "to measure: …" instead.
- Aggregates only; never name members (public repo, privacy).
- Never judge members by age, gender, nationality or appearance. Under-18s are not HOCKIA members (waitlist only).

## Method
1. **Who and when.** Pick one role (player, coach — candidate or recruiting, club, umpire, brand) and one situation: first visit, a normal weekday open, a moment of need (season ending, window opening, injury, contract ending, a role to fill).
2. **The job statement.** "When [situation], I want to [motivation], so I can [outcome]." One functional job, then the emotional ("feel taken seriously by clubs") and social ("be seen as a professional") sides.
3. **Pains** — what makes it hard today (in hockey and in HOCKIA). **Gains** — what "it worked" looks like for them.
4. **Current alternatives** — what they do instead: WhatsApp groups, agents, coach referrals, Instagram, federation sites, word of mouth. HOCKIA competes with these, not with Instagram's feed.
5. **Fit check for the screen** — for each section of the screen: which job does it serve? If none, it's a candidate to remove or move. Name the primary action per role.
6. **How we'd know** — the event or test that would show the job got done (e.g. "applications started from Home", "clubs reply within the window").

## Output template
```
# Jobs — <screen or feature>, <role>
Status: hypothesis map | partly evidenced
## Situation
## Core job  — When …, I want to …, so I can …   [Evidence|Hypothesis]
## Emotional / social jobs
## Pains (ranked)                 [tag each]
## Gains (what success looks like) [tag each]
## Alternatives they use today
## What the screen should do
| Section | Job it serves | Keep / move / remove | Why |
## Primary action
## How we'll know (measure / test)
## Open questions → interview plan (hockia-member-interviews)
```

## HOCKIA starting points (hypotheses unless `user-research.md` says otherwise)
- Player: "When I want to play somewhere better or abroad, I want the right clubs to find and trust me, so I can get a place on a team."
- Recruiting club/coach: "When I have a spot to fill, I want fitting, available people and a fast way to answer them, so I can sign the right person before the season."
- Brand: "When I want athletes to wear my gear, I want to be visible to the right players, so I can find ambassadors."
- Umpire: "When I build my officiating career, I want my appointments and references in one credible place."

Tie every conclusion back to the founder's question: **what did the member come to get, and how does this help them get it?**
