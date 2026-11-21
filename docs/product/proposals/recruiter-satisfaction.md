# Recruiter satisfaction: measuring whether clubs and recruiting coaches get what they came for

Proposal for the founder, 2026-11-21. Phase 2 approved for build the same day (see Founder rulings); phase 3 is not. Evidence is from read-only aggregate queries on production the same day (test accounts excluded). Targets are marked **[TARGET]** and are placeholders until four weeks of data exist. Aggregates only: no names, ids or quotes (ADR 0006).

## Why

A club or a recruiting coach comes to HOCKIA to fill a place in a team with little time to spare. Today we record what recruiters do, but almost nothing about whether it worked for them or what got in the way. Without that we cannot tell a product problem from a measurement problem, and we cannot say with evidence that the value proposition for clubs holds.

## What we know (production, 2026-11-21)

| Area | Finding |
|---|---|
| Adoption | 42 clubs; 17 have published at least one role, 25 never have. 4 coaches have published roles. |
| Demand | 40 published roles received 333 applications. 2 roles received none. |
| Decisions | 73 applications have a decision by the recruiter (shortlisted, not selected, maybe, offered). 195 expired without an answer. 65 are still pending. |
| Speed | For the 73 decided applications: median 7.6 days from application to decision; a quarter within 1 day, a quarter after 48 days. |
| Closing | 16 roles closed: 14 by automatic expiry, 1 marked filled (not through HOCKIA), 1 withdrawn. 1 offer sent through the app; no signing recorded. |
| Repeat use | 11 of 21 recruiters published more than one role; 4 published again more than 30 days after their first. 12 were active in the last 14 days. |
| Conversations | In the last 30 days recruiters sent 104 messages and started 44 conversations, against 25 applicant status changes. |
| App rating prompt | Shown to 33 clubs and coaches: 7 rated (all 5), 22 dismissed. |
| Problem reports | The feedback form (Settings only) has no production entries from any role. |
| Outcome field | `filled_via_hockia` is empty on 15 of 16 closed roles, because roles expire on their own and nobody is asked. |

## What we cannot tell

- **Whether recruiters fill places with HOCKIA candidates.** They talk to candidates in chat far more than they move them through statuses, and they may finish the deal by phone or email. The record of a signing is missing either way.
- **Whether reviewing 20 to 30 applicants is too much work**, or whether the applicants are not relevant enough to answer.
- **Why 25 clubs never published a role.**
- **What recruiters find hard or broken.** No channel collects it where the work happens.

Reporting trap found while reading the data: 121 automatic expiries are stored with the recruiter as the author of the change. Any "answered by the recruiter" number must filter on `changed_via`, not on who changed the status.

## Hypotheses (to test, not conclusions)

- R1. Recruiters value HOCKIA as a source of candidates and close outside the app, so our outcome data understates the value delivered.
- R2. Answering every applicant feels like administration; recruiters answer the few they want and leave the rest to expire.
- R3. Applicant relevance varies a lot by role, and requirements set by mistake (for example a passport requirement) hide good candidates.
- R4. Clubs that never published were invited before they had a place to fill.

## What we would measure

Five instruments. Each one answers a question the data cannot.

### 1. Outcome when a role closes

When a recruiter closes a role, and once when a role expires on its own (the next time they open the app):

- "Did you fill this place?" Yes, with someone from HOCKIA / Yes, with someone else / No, still looking / No, we stopped looking.
- If "someone from HOCKIA": optional "Who?" picked from that role's applicants, so the signing is recorded.

For a role that expired this is a one-line banner on the recruiter's roles screen, one role per app session; the question itself opens in a bottom sheet only when the recruiter taps "Answer".

Stored in the existing `closed_reason` and `filled_via_hockia` plus one new answer value for "still looking". Two taps; can be skipped, and a skip is recorded as such.

### 2. One question after reviewing applicants

After a recruiter has opened five applicants of a role (or all of them if fewer), once per role:

- "How relevant were these applicants for this role?" 1 to 5.
- Optional: "What was missing?" Level / Position / Availability / Location or visa / Other, plus free text.

This is the closest thing to a satisfaction score for the core job, tied to one role, so it can be compared across roles, countries and categories.

### 3. Effort after a first full cycle

Once per recruiter, after their first role closes: "How easy was it to find and contact candidates on HOCKIA?" 1 to 5, with optional free text. One recurring check every 90 days for active recruiters, never more.

### 4. Problems where the work happens

"Report a problem" on the recruiting screens (applicants list, applicant review, post a role), opening the existing feedback form with the screen and role already attached. The form exists; today it is only reachable from Settings.

### 5. Health metrics from data we already have

Per recruiter and in aggregate, on an admin screen:

| Metric | Definition |
|---|---|
| Time to first applicant | Publish to first application |
| Share answered | Applications with a recruiter decision or a recruiter message, over applications received |
| Time to answer | Application to first decision or first message from the recruiter |
| Expired unanswered | Applications closed by automatic expiry with no message from the recruiter |
| Outcome known | Closed roles with an answer to instrument 1 |
| Repeat publishing | Recruiters who publish again within 90 days of closing a role |

"Answered" must count a chat message as an answer: today the status is the only signal and it misses most recruiter contact.

### Interviews

Six to eight recruiters, 20 minutes each, run by the founder: two who answered most applicants, three who received many and answered few, two clubs that never published, one recruiting coach. Five fixed questions: what they needed, what they did first, where they stopped, how they finished the hire, what they would change. Notes stay outside this repository; this file gets the aggregate reading.

## Rules for every prompt

- One question at a time, tied to something the recruiter just did. Never at app open, never during a task.
- At most one prompt per recruiter per 14 days across all instruments. Dismissing counts as shown.
- Recruiter answers are never shown to players, and never used to rank or score applicants.
- Reports are aggregate. A single recruiter's answers are visible only to admins.
- English and Spanish; neutral wording; no outcome promises.
- Additive schema only, so installed app builds are unaffected.

## How we would read it

| Signal | Reading | Next step |
|---|---|---|
| Most closed roles answer "filled with someone from HOCKIA" | R1 holds: the value is real and was unrecorded | Make closing and recording a signing easier; use the number publicly only with the founder's approval |
| Relevance below **[TARGET: 3.5 of 5]** | Applicant quality or role requirements are the problem | Review role requirements and matching before anything else |
| Relevance fine, share answered low | R2 holds: answering is the cost | Batch answers and suggested replies for the recruiter |
| Effort below **[TARGET: 3.5 of 5]** | Finding or contacting candidates is hard | Use the free-text reasons and the interviews to choose the fix |
| Fewer than a third of prompts answered | The prompts are in the wrong place or badly worded | Change placement before trusting any score |

With about 20 active recruiters, scores are indicative, not statistical. The interviews carry as much weight as the numbers until volume grows.

## Phases

1. **No code, this week:** the interviews, and a baseline of the health metrics from existing data.
2. **Small build:** instrument 1 (outcome on close and after expiry) and instrument 4 (problem report on recruiting screens). Fixes the two blind spots with the least surface.
3. **After two weeks of phase 2 data:** instruments 2 and 3, and the admin screen for instrument 5.

Rough size: phase 2 is one PR with one migration; phase 3 is two PRs.

## Risks

- **Prompt fatigue.** Recruiters already dismiss two thirds of rating prompts. The 14-day cap and the tie to a finished action are the mitigation; the answer rate is the check.
- **Small numbers read as certainty.** Every report states the count behind each score.
- **Self-reported outcomes.** "Filled with someone from HOCKIA" is the recruiter's word. It is still far better than an empty field.
- **Asking without acting.** Each instrument has a decision attached above; an instrument with no decision should not ship.

## Founder rulings (2026-11-21)

- **Start with phase 2 now**: the outcome question on role close and after expiry, and "Report a problem" on the recruiting screens. Phase 3 waits for two weeks of data.
- **The signing answer stays private.** "Who did you sign?" is stored for measurement only. Nothing is published from it; a public signing still goes through the existing signing flow, with both sides confirming.
- **Ask about every role that already expired**, not only recent ones.
- **A banner, not a card or a pop-up.** The question for an expired role is a one-line banner above the roles (the role name, "Closed. Did you fill it?", Answer, X). "Answer" opens the question in a bottom sheet. A pop-up that opens by itself was discarded: recruiters arrive to answer applicants, and two thirds already close the app-rating pop-up without answering.
- **The X asks once more.** A closed banner comes back once, 14 days later; a second close ends it for that role.

## Still open

- Who runs the interviews and in which language.
