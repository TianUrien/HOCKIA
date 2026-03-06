# PLAYR Profile Completion & Trust Identity Strategy

**Date:** March 6, 2026
**Scope:** Product strategy to increase profile completion, social proof, and AI data readiness
**Goal:** Make users want to build a trusted identity — not just fill out forms

---

## 1. Current State Analysis

### What Works Well
- **Profile strength system** is role-specific with weighted buckets (7 for player, 6 for coach, 4 for club, 6 for brand)
- **Reference system** is sophisticated: role-aware relationship types, max 5 cap, endorsement text, trust graph
- **Denormalized counts** (friend_count, reference_count, career_entry_count) are trigger-maintained and fast
- **Onboarding email cadence** (24h, 72h, 7d) catches users who abandon during signup
- **AI search (discover_profiles)** already filters by reference count, career depth, position, age, nationality, availability
- **ProfileStrengthCard** exists on every dashboard with expandable checklist

### What's Broken or Missing
1. **No profile completion prompts on the home feed** — new users see generic "explore" cards
2. **References are invisible during onboarding** — users don't know they exist until they find the Friends tab
3. **No "Find Friends" flow** — users must manually visit other profiles to connect
4. **ProfileStrengthCard is passive** — it sits on the dashboard, doesn't appear contextually elsewhere
5. **No explanation of WHY completion matters** — no copy connects completion to visibility, trust, or opportunity matching
6. **Club claiming only happens at onboarding for club role** — players/coaches set "current club" as free text, missing the world_clubs link
7. **Friends are prerequisite to references, but this isn't clear** — users can't request references from non-friends
8. **No social proof visible to the user themselves** — they never see "Clubs have viewed your profile X times" or similar
9. **Post-onboarding, there's no guided next-step flow** — user lands on dashboard and has to self-discover
10. **AI search benefits are invisible** — users don't know that a complete profile makes them more discoverable

### AI Data Value Map

Fields ranked by AI matching impact:

| Tier | Field | AI Usage | Current Completion Estimate |
|------|-------|----------|---------------------------|
| S | `accepted_reference_count` | Trust signal, sort, filter | Very low (new users have 0) |
| S | `position` + `secondary_position` | Core role matching | High (required at onboarding) |
| A | `gender` | Competition category | High (required at onboarding) |
| A | `date_of_birth` | Age filtering (U21, U18) | Medium (optional for players) |
| A | `nationality_country_id` | Eligibility, EU passport | High (required at onboarding) |
| A | `base_country_id` + `base_city` | Location filtering | High (required at onboarding) |
| A | `current_world_club_id` | Club context, league inference | Low (players use free text instead) |
| A | `open_to_play/coach/opportunities` | Availability filter | Unknown (not prompted post-onboarding) |
| B | `career_entry_count` | Experience depth | Low (requires effort) |
| B | `mens/womens_league_id` | League-level filtering | Low (only set via club claim) |
| B | `highlight_video_url` | Not in AI yet, but should be | Low |
| B | `avatar_url` | Trust signal (visual) | Medium |
| B | `bio` | Not in AI search yet | Low |
| C | `accepted_friend_count` | Not in AI search yet | Medium |
| C | `post_count` | Not in AI search yet | Low |

**Key insight:** The S-tier and A-tier fields that are LOW completion are our biggest wins. Specifically:
- `accepted_reference_count` (almost everyone starts at 0)
- `current_world_club_id` (players use free text, miss the structured club link)
- `open_to_play/coach/opportunities` (not prompted after onboarding)
- `date_of_birth` (optional, many skip)

---

## 2. Core Strategic Framework

### The Trust Identity Loop

The strategy is built on one insight: **users don't complete profiles because they're told to — they complete profiles because they see the value of being trusted and visible.**

The loop:

```
Complete profile  -->  More discoverable  -->  Get found by clubs/coaches
      ^                                              |
      |                                              v
  See the value  <--  Get references  <--  Connect with people
```

Every feature we build should either:
1. **Reduce friction** in completing a high-value field
2. **Show the reward** of having completed it
3. **Create a social trigger** that makes the next action feel natural

### Three Psychological Drivers

1. **Identity** — "This is who I am in the hockey world" (photo, position, club, journey)
2. **Trust** — "People vouch for me" (references, endorsements, friend count)
3. **Opportunity** — "I get found by the right people" (visibility, AI matching, opportunity alerts)

Every prompt, nudge, and feature should invoke one of these three drivers — not "complete your profile" but "Get discovered by clubs in your league."

---

## 3. Feature Proposals (Prioritized)

### TIER 1: Quick Wins (1-3 days each, high impact)

---

#### 1.1 — Post-Onboarding Guided Checklist ("Your Next Steps")

**What:** After onboarding completes, instead of dumping users on a blank dashboard, show a focused "Welcome" overlay with 3-4 concrete next steps.

**Why:** The moment after onboarding has the highest motivation and lowest knowledge. Currently wasted.

**Design:**
```
Welcome to PLAYR, {firstName}!

Your profile is live. Here's how to make it stand out:

[x] Create your account                         Done!
[ ] Upload a profile photo                      2 min
[ ] Link your current club                      1 min
[ ] Add your first career milestone             3 min
[ ] Connect with someone you know               1 min

Clubs and coaches use these to evaluate players.
Complete all steps to unlock full visibility in search.

                              [Let's go]
```

**Behavior:**
- Appears once after first onboarding
- Persisted in localStorage (don't re-show)
- Each step links directly to the relevant action (edit modal, club search, journey tab)
- On completion of each step, the next one highlights
- Dismissed via "I'll do this later" (but persists as a smaller banner)

**Copy principle:** Every step explains WHAT the user gets, not what the platform wants.

---

#### 1.2 — Home Feed Profile Completion Card

**What:** Replace the current generic "Welcome to your feed / Browse Opportunities / Join the Community" empty state with a personalized profile completion card that appears at the top of the feed until key fields are filled.

**Why:** The home feed is visited most often. Currently shows zero profile-related prompts.

**Design:**
```
+------------------------------------------+
|  Your profile is 45% complete             |
|  ████████░░░░░░░░░░                       |
|                                           |
|  Next: Upload a profile photo             |
|  Profiles with photos get 3x more views.  |
|                                           |
|  [Add Photo]              [Dismiss]       |
+------------------------------------------+
```

**Logic:**
- Shows the single most impactful incomplete bucket (ordered by AI value, not weight)
- Priority order: photo > club > availability > reference > journey > video
- Dismissible per-item (shows next one), fully dismissible after 3 dismissals
- Disappears when profile reaches 80%+ or when all S/A tier fields are filled
- Stored in localStorage per profile ID

**Microcopy examples:**
- Photo: "Players with photos are **3x more likely** to be shortlisted."
- Club: "Link your club so coaches in your league can find you."
- Availability: "Let clubs know you're open to play."
- Reference: "Players with references rank higher in search results."
- Journey: "Add your career history so clubs can see your experience."

---

#### 1.3 — "Open To" Toggle Strip on Dashboard

**What:** Add a visible toggle strip on the player/coach dashboard (below the header, above tabs) for `open_to_play`, `open_to_coach`, `open_to_opportunities`.

**Why:** These booleans are high-value AI fields but are currently buried inside EditProfileModal. Most users never discover them. Making them one-tap toggles removes all friction.

**Design:**
```
+-------------------------------------------------------+
|  I'm open to:  [Play] [Coach] [Opportunities]         |
+-------------------------------------------------------+
```

- Green pill when active, gray when inactive
- Tap to toggle (instant save, no modal)
- Tooltip on first view: "Clubs searching for available players will find you"
- Only shown on own dashboard (not public view)

---

#### 1.4 — Smart Club Linking for Players/Coaches

**What:** When a player/coach has `current_club` (text) but no `current_world_club_id`, show a prompt: "Is this your club? [Club Name] — Link it for better visibility in your league."

**Where:** Dashboard profile card area OR EditProfileModal.

**Why:** `current_world_club_id` unlocks league-level AI filtering and the club's world directory page. Currently only clubs go through the claim flow during onboarding — players just type free text.

**Implementation:**
- Fuzzy-match `current_club` text against `world_clubs.club_name` in the user's country
- If 1-3 matches found, show them as suggestions
- If no match, show "Can't find your club? Add it to the directory"
- On link, set `current_world_club_id` and populate league fields

---

### TIER 2: Social Loop Features (3-7 days each, high impact)

---

#### 2.1 — "People You May Know" Discovery Module

**What:** A horizontally scrollable card row showing suggested connections, placed on the home feed after the completion card and/or in the Friends tab.

**Why:** Currently there's no friend discovery flow — users must manually navigate to profiles. This is the single biggest blocker to the friends-to-references loop.

**Suggestions algorithm (simple, no ML needed):**
- Same `current_world_club_id` (teammates)
- Same `mens_league_id` or `womens_league_id` (league peers)
- Same `base_country_id` + same `position` (position peers)
- Friends of friends (1-hop, from `profile_friendships`)
- Recently active users in same country

**Design:**
```
People you may know
+--------+ +--------+ +--------+ +--------+
| [photo]| | [photo]| | [photo]| | [photo]|  -->
| Name   | | Name   | | Name   | | Name   |
| GK     | | DEF    | | MID    | | FWD    |
|[Connect]| |[Connect]| |[Connect]| |[Connect]|
+--------+ +--------+ +--------+ +--------+
```

**Database:** New RPC `suggest_connections(p_profile_id, p_limit)` that returns ranked suggestions excluding existing friends, pending requests, and blocked users.

---

#### 2.2 — Reference Prompting After Friend Acceptance

**What:** When a friend request is accepted, show a contextual prompt: "You're now connected with {name}. Would you like to ask them for a reference?"

**Why:** The bridge from friend to reference is currently invisible. Users have to discover the reference system themselves. This prompt catches the peak moment of social engagement (just accepted a connection).

**Design (notification-style banner):**
```
+--------------------------------------------------+
|  You're now connected with Sarah Chen!            |
|                                                   |
|  Sarah can vouch for your skills as a reference.  |
|  References help clubs trust your profile.        |
|                                                   |
|  [Ask for Reference]         [Maybe Later]        |
+--------------------------------------------------+
```

**Behavior:**
- Appears as a toast/banner after accepting a friend request (not after sending one)
- "Ask for Reference" opens the existing AddReferenceModal pre-populated with the friend
- "Maybe Later" dismisses (no re-prompt for this specific friend)
- Only shows if user has <5 references (the max)

---

#### 2.3 — Reference Nudge on Public Profile View

**What:** When viewing a friend's public profile who hasn't given you a reference, show a subtle prompt: "You're connected with {name}. [Ask for a reference]"

**Why:** Visiting a friend's profile is a natural moment to think about references. Currently there's a FriendshipButton but no reference prompt.

**Design:** Small inline prompt below the FriendshipButton (only visible to friends who haven't exchanged references):
```
Connected since Jan 2026  |  Ask for a reference ->
```

---

#### 2.4 — "Trusted By" Badge on Profile Cards

**What:** Show a small badge on profile cards throughout the app (search results, applicant lists, discover results) indicating reference count.

**Design:** `Trusted by 3` with a small shield icon, shown when `accepted_reference_count >= 1`.

**Why:** Makes references visible everywhere — creates desire to get them. Users see other profiles with badges and think "I need that."

**Where it appears:**
- Search results (people tab)
- Discover (AI) results
- Applicant cards (for club owners reviewing applicants)
- Home feed post authors
- People You May Know cards

---

### TIER 3: Motivation & Visibility Features (5-10 days each)

---

#### 3.1 — Profile Views Counter (Private)

**What:** Show the profile owner how many times their profile has been viewed in the last 30 days. Private — only visible to the owner.

**Why:** LinkedIn's #1 engagement driver. Shows users that profile completion has real consequences. "Your profile was viewed 12 times this week" is more motivating than any completion bar.

**Implementation:**
- New table: `profile_views (id, profile_id, viewer_id nullable, viewed_at, source)`
- Track views from: search results clicks, direct URL, discover results, applicant list
- Don't track own views
- Dashboard widget: "12 profile views this month" with trend arrow
- Optional: "Profiles with photos get 3x more views" when they have no photo

**Privacy:** viewer_id is nullable (anonymous tracking allowed). Never show WHO viewed — only count and trend.

---

#### 3.2 — Milestone Cards & Celebrations

**What:** When a user completes a significant profile action, show a celebration card (not just a toast).

**Milestones:**
- First profile photo uploaded: "Looking good! Your profile is now 3x more likely to be noticed."
- First career entry: "Your journey has begun. Clubs can now see your experience."
- First friend connection: "You're building your network! Connected players get 2x more opportunities."
- First reference received: "You've earned trust. Referenced players rank higher in search."
- Profile 100% complete: "Your profile is complete! You're now fully visible to every club and coach on PLAYR."
- 3 references: "Trusted player! You're in the top 10% of PLAYR profiles."

**Design:** Full-width card on dashboard with confetti animation (subtle), appears once per milestone, dismissible.

---

#### 3.3 — Endorsement Quality Prompts

**What:** When a user accepts a reference request, guide them to write a meaningful endorsement with structured prompts instead of a blank text area.

**Current state:** Blank `<textarea>` with "Add your endorsement (optional)".

**Proposed:**
```
How would you describe {name}?

Quick tags (select all that apply):
[Hard worker] [Team player] [Natural leader] [Technically skilled]
[Coachable] [Consistent performer] [Great attitude]

Add a personal note (optional):
[What makes them stand out on and off the pitch?        ]
[                                                        ]

Your endorsement will be visible on their profile.
```

**Why:** Structured tags produce consistent, comparable data. The AI agent can eventually parse these tags for richer matching ("find players tagged as 'team player' by 2+ references"). Free text alone often gets skipped or produces low-quality input.

**Data model addition:**
- New column on `profile_references`: `endorsement_tags TEXT[]` (array of tag strings)
- Tags are predefined per role pair (player tags differ from coach tags)

---

#### 3.4 — "Complete Profile" Prompt in Opportunity Applications

**What:** When a player/coach applies to an opportunity, if their profile is <70% complete, show a warning:

```
Your profile is 45% complete.

Clubs are more likely to shortlist applicants with complete profiles,
photos, and references.

[Complete My Profile First]     [Apply Anyway]
```

**Why:** This is the highest-motivation moment — the user actively wants something (the opportunity). Connecting completion to their immediate goal drives action.

---

### TIER 4: Structural & AI Improvements (Background)

---

#### 4.1 — Add `highlight_video_url` to AI Search Ranking

**What:** Boost profiles with highlight videos in discover_profiles results. Add a `p_has_video` filter parameter.

**Why:** Video is the highest-signal media for player evaluation. Currently ignored by AI search.

**Implementation:**
- Add `AND (p_has_video IS NULL OR (p_has_video = true AND p.highlight_video_url IS NOT NULL))` to discover_profiles
- Add video presence as a ranking boost factor (+0.1 to relevance score)

---

#### 4.2 — Index `bio` in Search Vector

**What:** Add `bio` content to the `search_vector` tsvector field so AI search can match against bio keywords.

**Why:** "Find coaches interested in youth development" currently returns nothing because bio isn't indexed. This is a migration-only change.

---

#### 4.3 — "Most Connected" Sort Option

**What:** Add `accepted_friend_count` as a sort option in discover_profiles.

**Why:** Network size is a proxy for community engagement. Useful for clubs looking for well-connected players who can attract other talent.

---

## 4. Optimal Completion Sequence

The order in which we prompt users matters. This sequence maximizes both user motivation and AI data value:

### Onboarding (required fields — already implemented)
1. Name, location, nationality, position, gender

### Post-Onboarding Phase 1: "Make it real" (first 5 minutes)
2. **Profile photo** — Lowest effort, highest visual impact, 3x visibility claim
3. **Link current club** — Connects to world directory, unlocks league filtering
4. **Set availability toggles** — One tap each, high AI value

### Post-Onboarding Phase 2: "Build credibility" (first week)
5. **Add first career entry** — Establishes experience depth
6. **Connect with someone** — Opens the social graph
7. **Date of birth** — Unlocks age-based AI filtering (U21, U18)

### Post-Onboarding Phase 3: "Earn trust" (first month)
8. **Request first reference** — Requires a friend, so naturally comes after step 6
9. **Add highlight video** — Higher effort, but high signal
10. **Write a bio** — Lowest urgency, but enriches AI text matching

This sequence works because each phase builds on the previous:
- Phase 1 is solo (no dependencies)
- Phase 2 introduces social (requires finding other users)
- Phase 3 requires existing connections (references need friends)

---

## 5. Microcopy Bank

### Profile Completion Prompts

**Photo:**
- "Add a photo so clubs know who they're looking at."
- "Profiles with photos are 3x more likely to be shortlisted."
- "Put a face to your name."

**Club:**
- "Link your club to appear in league searches."
- "Coaches in your league will find you faster."
- "Which club do you currently play for?"

**Availability:**
- "Let clubs know you're open to play."
- "Clubs searching for available players will see you first."
- "Toggle on to get discovered."

**References:**
- "References are your strongest signal to clubs."
- "Players with references rank higher in search."
- "Ask a coach or teammate to vouch for your skills."

**Journey:**
- "Your career history helps clubs evaluate your experience."
- "Where have you played? Add your first milestone."

**Video:**
- "Show clubs what you can do. Add your highlight reel."
- "A 30-second clip says more than 1,000 words."

### Milestone Celebrations

- First photo: "Now clubs can see who you are."
- First connection: "Your network is growing. Connected players discover more opportunities."
- First reference: "Earned trust. Referenced players rank higher in every search."
- 100% complete: "Your profile is now fully visible. You're ready to be discovered."

### Nudge Framing (Do / Don't)

- DO: "Get discovered by clubs in your league" (benefit)
- DON'T: "Complete your profile" (task)
- DO: "Players with references rank higher" (social proof)
- DON'T: "Add a reference to improve your profile" (homework)
- DO: "Coaches use this to evaluate you" (stakes)
- DON'T: "This field is recommended" (vague)

---

## 6. Data Model Changes Required

### New Table: `profile_views`
```sql
CREATE TABLE profile_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'direct',  -- 'search', 'discover', 'applicant', 'direct'
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profile_views_profile_month ON profile_views (profile_id, viewed_at);
```

### New Column: `endorsement_tags` on `profile_references`
```sql
ALTER TABLE profile_references ADD COLUMN endorsement_tags TEXT[] DEFAULT '{}';
```

### New RPC: `suggest_connections`
```sql
CREATE FUNCTION suggest_connections(p_profile_id UUID, p_limit INT DEFAULT 10)
RETURNS TABLE (
  id UUID, full_name TEXT, username TEXT, avatar_url TEXT,
  role TEXT, position TEXT, current_club TEXT, reason TEXT
) ...
```

Ranking logic:
1. Same world_club_id (weight 10) — "Teammate"
2. Same league_id (weight 5) — "In your league"
3. Friend-of-friend (weight 3) — "Mutual connection with {name}"
4. Same country + position (weight 2) — "Nearby {position}"
5. Recently active in same country (weight 1)

Excludes: existing friends, pending requests, blocked, self, test accounts.

### Migration: Add `bio` to search_vector trigger
Update the profile search vector trigger to include `bio` text for FTS matching.

---

## 7. Execution Plan

### Sprint 1: Foundation (Week 1)
**Goal:** Make completion visible and reduce friction for solo actions.

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 1 | Home feed profile completion card (1.2) | 2 days | High — seen every session |
| 2 | "Open To" toggle strip on dashboard (1.3) | 0.5 day | High — 3 fields, zero friction |
| 3 | Smart club linking for players/coaches (1.4) | 1.5 days | High — unlocks AI league filtering |
| 4 | "Trusted By" badge on profile cards (2.4) | 1 day | Medium — creates desire for references |

### Sprint 2: Social Loops (Week 2-3)
**Goal:** Get users connecting and requesting references.

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 5 | "People You May Know" module (2.1) | 3 days | High — unlocks friend discovery |
| 6 | Reference prompt after friend acceptance (2.2) | 1 day | High — bridges friend→reference gap |
| 7 | Post-onboarding guided checklist (1.1) | 1.5 days | Medium — first-session guidance |
| 8 | Reference nudge on public profiles (2.3) | 0.5 day | Medium — passive reference prompting |

### Sprint 3: Motivation & Quality (Week 3-4)
**Goal:** Show users the value of completion and improve data quality.

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 9 | Profile views counter (3.1) | 2 days | High — LinkedIn's #1 engagement driver |
| 10 | Complete profile prompt in opportunity applications (3.4) | 0.5 day | High — catches peak motivation |
| 11 | Endorsement quality prompts with tags (3.3) | 2 days | Medium — structured AI-ready data |
| 12 | Milestone celebration cards (3.2) | 1 day | Medium — emotional reward |

### Sprint 4: AI Enhancements (Background, any time)
**Goal:** Make the AI smarter with existing data.

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 13 | Add highlight_video to AI search ranking (4.1) | 0.5 day | Medium |
| 14 | Index bio in search_vector (4.2) | 0.5 day | Medium |
| 15 | "Most connected" sort in discover (4.3) | 0.5 day | Low |

---

## 8. Success Metrics

### Primary KPIs
- **Profile completion rate** (% of users at 80%+ strength) — target: 60% within 30 days of signup
- **Reference adoption** (% of users with >= 1 accepted reference) — target: 30% within 30 days
- **Photo upload rate** — target: 80% within 7 days of signup
- **Club linking rate** (current_world_club_id not null) — target: 50% of players/coaches

### Secondary KPIs
- Average profile strength at day 7, 14, 30
- Friend request sent rate (% of users who send at least 1)
- Reference request rate (% of users who request at least 1)
- Availability toggle activation rate (% with at least 1 "open to" set)
- Profile views per user (leading indicator of discovery value)

### Leading Indicators (AI Readiness)
- % of profiles with all S-tier fields filled
- % of profiles with >= 1 A-tier field empty
- Average endorsement text length
- Endorsement tag adoption rate (once implemented)

---

## 9. What NOT to Do

1. **Don't make more fields mandatory at onboarding.** Onboarding friction kills signup conversion. The current required fields (name, location, nationality, position, gender) are the right balance. Everything else should be post-onboarding.

2. **Don't gamify with points, badges, or leaderboards.** This is a professional network, not a game. Professionals respond to visibility, trust, and opportunity — not XP points. The profile strength percentage is already the right level of gamification.

3. **Don't send more emails.** The 3-touch cadence is good. Instead, invest in in-app nudges that are contextual and timely.

4. **Don't require references for basic features.** References should unlock VISIBILITY (higher ranking in search), not ACCESS (ability to apply to opportunities). Gating features behind references punishes new users.

5. **Don't show completion prompts to users who are actively doing something else.** If a user is reading a post or messaging someone, don't interrupt with "complete your profile." Prompts should appear in natural resting states (home feed, dashboard, empty states).

6. **Don't fake social proof numbers.** "Profiles with photos get 3x more views" should be true or not stated. Track actual view rates and use real data once available. Until then, use directional language: "more likely" instead of "3x more."

---

## 10. Summary: The One-Line Strategy

**Make every incomplete field feel like a missed opportunity, and every completed field feel like a trust signal that opens doors.**

The user should never think "I need to complete my profile." They should think "I want clubs to find me" and "I want my references to speak for me." The profile is not a form — it's their professional identity in the hockey world.
