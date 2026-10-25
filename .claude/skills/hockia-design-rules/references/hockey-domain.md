# Field hockey domain

## Sport accuracy
- Always field hockey, never ice hockey (no skates, pucks or rinks).
- Pitch 91.4 × 55 m. Markings: centre line, two 23 m lines, a shooting circle "D" at each goal (two quarter-circles of radius 14.63 m joined by a 3.66 m straight), a dashed line 5 m outside the circle, penalty spot 6.4 m from the goal. **No centre circle**; never mix in football markings. Decorative pitch lines must be drawn to scale.
- Sticks are right-handed: a flat face and a rounded back; looking at the flat face with the head down, the toe curls left. The ball is played with the flat face and edges only. Grip: left hand on top, right hand lower.
- Rules answers (e.g. drag flick) should point to the current FIH rulebook for exact wording.

## Roles in HOCKIA
Player, Coach, Club, Umpire, Brand. Role badges use the role colours. Coaches may recruit for a team (`coach_recruits_for_team`); a coach posting a role for a club is shown as "Posted by" with the club as the hiring entity.

## Categories (teams)
Men's, Women's, Mixed (adult); Girls, Boys (youth; coach roles only: player roles are adult only). Display labels follow `lib/opportunityCopy.ts`; stored values are the legacy enum (`Men`, `Women`, `Girls`, `Boys`, `Mixed`).

## Vocabulary
- "Role" / "opportunity" for a club or coach posting; "Apply", "Applied", "Shortlisted", "Maybe", "Not this time" (player view; "Not selected" until 2026-10-25), "Declined" (recruiter view), "Closed".
- "New signing" for a club announcing a player or coach joining.
- "References" (gold) for endorsements; "Open to play", "Open to coach", "Open to tournaments", "Open to partners" for availability flags.
- Seasons written "2026/27".
- Passports and EU eligibility matter for recruiting; show them clearly (see nationality rulings).
