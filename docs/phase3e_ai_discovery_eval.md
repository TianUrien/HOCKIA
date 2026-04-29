# Phase 3e AI Discovery — staging eval suite

A curated set of queries to verify the LLM prompt + RPC + UserContext seeding
work correctly after the gender → hockey-category migration. Each row lists
the **expected parsed intent** and **expected RPC behavior**. Run on staging
before promoting Phase 3e to production.

## How to run

There are two ways to execute this suite. Pick the one that fits your
environment.

### A. Manual — staging UI

Open the staging frontend at
`https://hockia-git-staging-cristian-uriens-projects.vercel.app` (or
`https://staging.inhockia.com` once that domain is live). Sign in as a test
user matching the row's "Logged-in as" column, type the query into the
HOCKIA AI input, and verify the response by:

- Looking at the chip strip above the result body — the category chip should
  match the expected value (e.g. "Adult Women", not "Women").
- Looking at the `_meta.effective_category` field on the response (visible
  via DevTools → Network → nl-search response).
- Counting results — should match the row's expected behavior.

### B. Programmatic — curl with a real user JWT

For the rows that don't depend on a specific logged-in user (no UserContext
seeding), you can hit the staging Edge Function directly:

```sh
curl -s -X POST \
  -H "Authorization: Bearer ${TEST_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"query": "find women'\''s clubs"}' \
  https://ivjkdaylalhsteyyclvl.supabase.co/functions/v1/nl-search \
  | jq '{ kind: .data._meta.kind, effective_category: .data._meta.effective_category, category_source: .data._meta.category_source, total: (.data.search_state.applied // null), data_count: (.data.data | length) }'
```

`TEST_JWT` should be a JWT for a real staging user (different rows reference
different users, so swap as needed).

## Test rows

### A. Direct category queries (parse-only — no UserContext needed)

| # | Query | Logged-in as | Expected `target_category` | Expected `effective_category` | Notes |
|---|---|---|---|---|---|
| 1 | "Find women's clubs" | any | `adult_women` | `adult_women` | Old vocabulary still parses to new category |
| 2 | "Find men's clubs" | any | `adult_men` | `adult_men` | Same |
| 3 | "Find Adult Women coaches" | any | `adult_women` | `adult_women` | New canonical phrasing |
| 4 | "Find Adult Men coaches" | any | `adult_men` | `adult_men` | |
| 5 | "Find Girls coaches" | any | `girls` | `girls` | |
| 6 | "Find Boys umpires" | any | `boys` | `boys` | |
| 7 | "Find Mixed players" | any | `mixed` | `mixed` | |
| 8 | "Find players for a girls team" | any | `girls` | `girls` | Implied via "girls team" |
| 9 | "Find umpires for boys hockey" | any | `boys` | `boys` | Implied via "boys hockey" |

### B. Logged-in user-context seeding

| # | Query | Logged-in as | Expected `effective_category` | Expected `category_source` | Notes |
|---|---|---|---|---|---|
| 10 | "Show me clubs for my category" | Adult Women player | `adult_women` | `context` | Seeded from `playing_category` |
| 11 | "Show me clubs for my category" | Adult Men player | `adult_men` | `context` | |
| 12 | "Show me clubs for my category" | Girls player | `girls` | `context` | (need a Girls test profile) |
| 13 | "Show me clubs for my category" | Mixed player | `mixed` | `context` | (need a Mixed test profile) |
| 14 | "Find clubs for me" | Coach with `['adult_women']` | `adult_women` | `context` | Single-category coach: seed |
| 15 | "Find clubs for me" | Coach with `['adult_women', 'girls']` | `null` | `none` | Multi-category coach: don't seed |
| 16 | "Find clubs for me" | Coach with `['any']` | `null` | `none` | "Any" coach: don't seed |

### C. Broaden / show-all queries (must NOT auto-seed)

These exercise the `QUERY_FORBIDS_CATEGORY_SEED` regex. Even if the user has
a category in their profile, these phrasings must skip the seed.

| # | Query | Logged-in as | Expected `category_source` | Notes |
|---|---|---|---|---|
| 17 | "Show me all clubs" | Adult Women player | `none` | Phrase matches the regex |
| 18 | "Find clubs regardless of category" | Adult Men player | `none` | Phrase matches |
| 19 | "Remove category filter" | Adult Women player | `none` | Phrase matches |
| 20 | "Find clubs in any category" | Adult Men player | `none` | Phrase matches |
| 21 | "Show all clubs regardless of gender" | Adult Women player | `none` | Legacy phrasing still recognized |

### D. Vague queries (no category should be set)

| # | Query | Expected `target_category` | Notes |
|---|---|---|---|
| 22 | "Find players" | `null` | Generic — model should not guess |
| 23 | "Show me coaches" | `null` | Generic |
| 24 | "Who's open to play?" | `null` | Availability-only filter |

### E. Combined filters

| # | Query | Expected fields | Notes |
|---|---|---|---|
| 25 | "Find Adult Women defenders in Argentina" | `target_category=adult_women`, `positions=['defender']`, `nationalities=['Argentina']` | Multi-filter combo |
| 26 | "Girls U18 goalkeepers in Spain" | `target_category=girls`, `max_age=17`, `positions=['goalkeeper']`, `nationalities=['Spain']` | Age + category combo |
| 27 | "Mixed coaches with verified references" | `target_category=mixed`, `roles=['coach']`, `min_references>=1` | Coach + category + references |

### F. Backward compatibility — legacy `gender` field

These confirm that any in-flight client still emitting the deprecated
`gender` field gets routed correctly.

| # | Direct RPC call | Expected | Notes |
|---|---|---|---|
| 28 | `discover_profiles(p_roles:=['player'], p_gender:='Men')` | Returns adult_men players (uses internal mapping) | RPC translates legacy gender |
| 29 | `discover_profiles(p_roles:=['player'], p_target_category:='adult_men')` | Returns same set as #28 | Equivalence check |
| 30 | `discover_profiles(p_roles:=['player'], p_gender:='Women', p_target_category:='girls')` | Returns Girls players (target_category wins) | Newer param takes priority |

### G. Recovery / no-results flow

| # | Query | Expected `kind` | Expected suggested actions |
|---|---|---|---|
| 31 | First call: "Find women's clubs in nowhere-land" | `no_results` | Includes "Show all clubs" + "Remove Adult Women filter" |
| 32 | Then: tap "Remove Adult Women filter" chip | Re-runs without category | `effective_category` should be null |
| 33 | Tap "Show all clubs" chip | Broader search | `category_source` should be `none` |

## Diff vs Phase 3a-3d

| Aspect | Pre-Phase-3e | Post-Phase-3e |
|---|---|---|
| LLM tool field | `gender: 'Men' \| 'Women'` | `target_category: 'adult_women' \| ...` (gender deprecated) |
| Prompt vocabulary | "use Men or Women exactly" | "use adult_women / adult_men / girls / boys / mixed" |
| RPC parameter | `p_gender` only | `p_target_category` (preferred) + `p_gender` (back-compat) |
| Filter route for player | `p.gender = p_gender` | `p.playing_category = v_effective_category` |
| Filter route for coach | `p.gender = p_gender` (broken — coaches have null gender post-Phase-3b) | `coach categories array overlap` |
| Filter route for umpire | `p.gender = p_gender` (broken — umpire gender no longer collected) | `umpire categories array overlap` |
| Filter route for club/brand | excluded when gender filter set | NOT filtered (gets through; let league/country filters do their work) |
| UserContext seeding | `userContext.gender` → `Men/Women` | `userContext.playing_category` (or `coaching_categories[0]` for single-category coaches only) |
| Applied chip label | `Men` / `Women` | `Adult Men` / `Adult Women` / `Girls` / `Boys` / `Mixed` |
| "Remove X filter" chip | `Remove women filter` | `Remove Adult Women filter` |
| "Show all" chip query | `Show me all clubs regardless of gender` | `Show me all clubs regardless of category` (regex still accepts both) |

## Known gaps + behavior changes to QA

1. **Coaches now appear in category-filtered searches.** Pre-3e they were
   excluded because their `gender` column is null post-Phase-3b. This is
   the explicit fix.
2. **Clubs no longer excluded by category filter.** A "find Adult Women
   clubs" search now returns clubs (because clubs don't have a category).
   League / country filters do the actual narrowing. Watch for over-broad
   results.
3. **Multi-category coaches don't auto-seed.** Coach with categories
   `['adult_women', 'girls']` doing "find clubs" gets all clubs, not
   women's clubs. Trade-off accepted to avoid over-restriction.
4. **"Any" coaches don't auto-seed.** Same reason.
5. **Phase 3a-3c categories on staging are limited to player+coach.** No
   Girls / Boys / Mixed test profiles exist on staging yet — those rows
   will return 0 until manually created. Doesn't invalidate the eval; just
   note that category routing works even with empty result sets.
