# Home as a social feed of posts

Proposal for the founder, 2026-11-24. Direction and the rulings below are the founder's; the build is not approved yet. Evidence is from read-only aggregate queries on production the same day (test accounts excluded). Targets are marked **[TARGET]** and are placeholders until four weeks of data exist.

## Founder direction (2026-11-24)

Home is a feed of posts, in the style of the Instagram or LinkedIn home: one post under the other, made by people. This replaces the earlier Home directions in `home-vision.md` (agent's desk, moves, "your next step") as the purpose of the Home tab. Reported the same day: Home feels odd because automatic cards repeat while scrolling.

## Founder rulings (2026-11-24)

- Home is a feed of posts by people, Instagram or LinkedIn style.
- **Only posts.** Highlight videos and photos added to a profile do not come back to Home; the 2026-11-10 ruling stands. Home shows what a member chose to post.
- **The founder accepts the low-content risk** knowing the numbers below, and will push posting himself in the first days after launch.
- The weekly "N joined this week" card shows once, for the current week only (shipped to staging the same day).

## What Home is today (production)

| Area | Finding |
|---|---|
| Size | A member's whole Home is 50 items. |
| Automatic cards | 13 of the 50 were "N joined this week" cards, one per past week (fixed 2026-11-24, one card now). The rest is mostly opportunities and an "open to play" card. |
| Posts by people | 1 post in the first 12 items. |
| Posting | 21 posts in 90 days, by 9 members. One member wrote 43% of them. All were players and all had a photo or video. |
| Other roles | No club, coach, umpire or brand posted in 90 days. |
| Profile uploads | In 30 days members added 36 videos and 37 photo sets to their profiles. These were removed from Home on 2026-11-10 and stay on the profile. |
| Usage (2026-10-19 read) | Home is a waypoint: under one Home session per member per week. |

## The problem to solve

A feed of posts needs posts. Members already produce content, but they put it on their profile, not in the feed. With today's posting rate a posts-only Home is nearly empty; padded with automatic cards it feels automatic again, which is the complaint. The founder chose posts only and will seed the feed himself at launch, so the product work is to make posting obvious and to give every role a reason to post.

## Proposal

1. **Home shows posts only.** A post is a photo, a video or text from a member, with name, role and club, likes and comments. Automatic cards (new members, open to play, opportunities) leave the feed; they already live in Community and Opportunities.
2. **Posting is one obvious step.** A clear "Post" entry at the top of Home, opening straight to the camera roll, with the caption optional.
3. **Each role gets a reason to post, in one tap.** A club that signs a player, opens an opportunity or wants to share a result gets "Post this" at that moment, with the post drafted from facts it already entered. Same for a coach. Nothing is posted without the tap.
4. **Order: newest first**, across all of HOCKIA. No ranking until there is enough volume for ranking to matter.
5. **When the feed runs out, it ends** with a short, honest end ("You're up to date") and one prompt to post. No filler.

## What it is not

- Not a place for scores, rankings or levels of people. Design rules stand: players never see fit scores or rankings.
- Not an ad surface. Brand posts follow the existing brand rules.
- No activity or last-seen signals.

## Hypotheses (to test, not conclusions)

- F1. Members will post when posting is the first thing Home offers and the feed visibly has other people's posts.
- F2. Members whose post gets reactions will post again.
- F3. Clubs will post when the post is drafted for them at the moment something happens, and will not open a blank composer.
- F4. A Home with fewer, real items is preferred to a longer Home padded with automatic cards.

## What we would measure

- Posts per week and distinct members posting per week, by role. **[TARGET]**
- Share of Home items that are posts by people (today about 1 in 12 at the top).
- Reactions and comments per post, and how many posts get none.
- Second post within 30 days of the first.
- Home sessions per member per week (context only; time in app is not a goal).

## Open questions for the founder

1. Do opportunities leave the Home feed completely, or stay as one compact rail?
2. Which role should get the one-tap "Post this" first: clubs (signings and new opportunities) or players (a new highlight)?

## Order of work, if approved

1. Posts-only feed (server change to the feed function, one client pass).
2. The "Post" entry at the top of Home.
3. One-tap posts for clubs.
4. Read the measures after four weeks before anything else.
