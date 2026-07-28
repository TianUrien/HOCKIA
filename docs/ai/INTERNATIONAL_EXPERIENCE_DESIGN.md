# Hockia AI — International / Representative Experience

**Design doc. Gate for building — nothing below is implemented yet.**
Incident: 2026-07-23, reproduced from `discovery_events` (see §1).
Author: Claude, 2026-07-27. Status: **awaiting founder sign-off on §8.**

---

## 1. The incident, verified in prod

Two failures for the same intent, logged in `discovery_events` on 2026-07-23:

| Query | What happened |
|---|---|
| *"What? In looking for players who played in the Argentina national team"* | Parsed `{roles:[player], nationalities:["Argentina"], text_query:"Argentina national team"}` → 1 result whose only match was **passport**. The LLM's own summary narrated the bug: *"Showing player profiles from Argentina, searching for national team experience."* |
| *"Are there any Argentina selection national team in the app?"* | Keyword router saw "team" → **`world_club_search`** → searched the clubs directory → 0 results. |

Same intent, two different wrong answers. The fix must catch NT phrasing
**before tool selection**, not just inside the search filter parse.

## 2. Data reality (this changes the design)

`career_history` prod: 68 club / **28 national_team** / 1 tournament / 1 achievement / 1 milestone.

Reading all 28 NT rows exposed **three traps a naive join would hit**:

1. **`location_country` is the HOST country, not the represented country.**
   "2022 Pan American Cup" has `location_country=Chile` — where it was
   played. Matching `location_country='Argentina'` would produce a new
   flavour of the original bug: right column, wrong meaning.
2. **Provincial selections live in `entry_type='national_team'`.**
   "Buenos Aires Selection Team", "Victorian mens state team", "Wellington".
   Buenos Aires ≠ Argentina caps. Worse: `country_text_aliases` maps
   "buenos aires" → Argentina at confidence=medium — so the alias table
   itself would convert a provincial team into national caps unless we
   restrict to **confidence='high'** aliases.
3. **Some rows carry no represented country at all.** One GK logged pure
   tournament rows ("FIH World Cup", location=Spain=venue). Represented
   country is not derivable from the row. These can match *tournament*
   filters but not *country* filters.

Also: several rows are misfiled (a university, two clubs, a coaching role)
and there are masters entries ("England Masters O35"). Coverage is thin —
**the founder's product follow-up (structured International section) is
even more justified than the brief assumed.** (Flagged, not this PR.)

**Consequence:** the *verified* tier must match the country against
`club_name` / `badge_label` / `division_league` **text** via high-confidence
aliases — never `location_country` alone, and never city-level aliases.

**Expected prod outcome for the incident query, under this design:**
verified senior Argentina caps = **0** today; 1 junior entry ("Argentina
U19 … training camps"); so the correct answer is the honest zero with the
junior mention and the nationality pivot. The incident query lands exactly
on the honesty contract, which is the point.

## 3. Filter schema (exact shape)

```ts
// _shared/llm-client.ts — added to ParsedFilters
international_experience?: {
  /** Country the person REPRESENTED (not passport). Names as typed;
   *  resolved to country_ids via country_text_aliases (confidence='high'). */
  countries?: string[]
  /** senior | junior. Absent = any. Junior = U16/U19/U21/junior/youth
   *  markers. Masters counts as senior but is labelled (see §8 Q2). */
  level?: 'senior' | 'junior'
  /** Canonical tournament keys from the shared taxonomy (§4). */
  tournaments?: string[]
}
```

Distinct from `nationalities` (passport) and `countries` (where clubs are).
All three can coexist: *"Argentine defenders who played for Spain"* →
`nationalities:["Argentina"], international_experience:{countries:["Spain"]}`.

## 4. Taxonomy — one place, data not code

New shared module **`_shared/international-taxonomy.ts`**, the single
source read by the parser rules, the retrieval builder, and the composer:

```ts
export interface TournamentDef {
  key: string                 // canonical, logged, stable
  tier: number                // 1 Olympics … 7 domestic top flight
  aliases_en: string[]
  aliases_es: string[]
  level_hint?: 'senior' | 'junior'   // junior_world_cup → junior
}
export const TOURNAMENTS: TournamentDef[] = [
  { key:'olympics', tier:1, aliases_en:['olympics','olympic games','olympian'], aliases_es:['juegos olímpicos','olímpicos','olimpiadas'] },
  { key:'world_cup', tier:2, aliases_en:['world cup'], aliases_es:['mundial','copa del mundo'] },
  { key:'junior_world_cup', tier:5, level_hint:'junior', aliases_en:['junior world cup','u21 world cup'], aliases_es:['mundial junior','mundial juvenil'] },
  { key:'eurohockey', tier:3, aliases_en:['eurohockey','euro hockey','the euro','european championship'], aliases_es:['eurohockey','campeonato europeo','la euro'] },
  { key:'pan_am', tier:3, aliases_en:['pan american cup','pan am cup','pan american games'], aliases_es:['panamericano','copa panamericana','juegos panamericanos'] },
  { key:'asia_cup', tier:3, … }, { key:'africa_cup', tier:3, … }, { key:'oceania_cup', tier:3, … },
  { key:'pro_league', tier:4, aliases_en:['pro league','fih pro league'], aliases_es:['pro league'] },
  { key:'nations_cup', tier:4, … }, { key:'commonwealth', tier:3, … },
  // Domestic top flights — tier 7, matched in league/division text:
  { key:'hoofdklasse', tier:7, … }, { key:'honor_division', tier:7, aliases_es:['división de honor'] … },
  { key:'bundesliga_hockey', tier:7, … }, { key:'england_premier', tier:7, … },
  { key:'hockey_one', tier:7, aliases_en:['hockey one'] }, { key:'hil', tier:7, aliases_en:['hockey india league','hil'] },
  { key:'metropolitano', tier:7, aliases_es:['metropolitano','torneo metropolitano'] },
]
export const NT_MARKERS_EN = ['national team','represented','international caps','capped for','played for <country>']
export const NT_MARKERS_ES = ['selección','seleccionado','seleccionada','equipo nacional','internacional con']
export const JUNIOR_MARKERS = ['u16','u17','u18','u19','u21','u23','junior','juvenil','youth']
```

Adding a tournament or a language = adding rows here. Moving this to a DB
table later is a follow-up, deliberately not v1 (28 rows of career data do
not justify a table + admin UI yet).

## 5. Parse binding — deterministic, not vibes

Two layers, same precedent as the existing "Phase 0 server-side role
enforcement" (which exists because the LLM dropped `roles` ~50% of the time):

**Layer 1 — LLM schema (belt).** `international_experience` added to the
tool schema with an explicit trap warning in the description: *"A country
name adjacent to 'national team' / 'selección' is the country REPRESENTED —
put it here, NOT in nationalities."*

**Layer 2 — deterministic post-parse rule in `nl-search/index.ts` (braces,
the actual guarantee).** After the LLM parse, before retrieval:

1. Scan the raw query for NT markers (EN+ES, from the taxonomy).
2. If found: extract the country token bound to the marker
   (window-of-3-words either side; both word orders — "Argentina national
   team" and "selección de Argentina").
3. If that country appears in `parsed.nationalities` **and** the query does
   not independently assert a passport ("Argentine players who…" pattern:
   a demonym token *separate* from the NT phrase), **move** it from
   `nationalities` → `international_experience.countries`.
4. Tournament aliases found anywhere in the query → `tournaments` keys;
   junior markers → `level:'junior'`.
5. Record `_meta.intl_binding_source: 'deterministic' | 'llm' | 'both'`.

**Router fix for failure #2:** the same NT-marker scan runs in the intent
router **before** tool selection; a match forces the profile-search tool
(entity players/coaches per the role noun) and blocks `world_club_search`
hijack. Logged as a router signal (`'national_team'`).

## 6. Retrieval — three tiers, provenance computed server-side

**Step A (new, in nl-search, before the RPC):** resolve
`international_experience` → profile-id sets:

```sql
-- VERIFIED tier. Text match on what the row SAYS, never host country.
SELECT DISTINCT ch.user_id, <matched fields for labels>
FROM career_history ch
WHERE ch.entry_type = 'national_team'
  AND (ch.club_name ILIKE ANY(:alias_patterns)     -- high-confidence only
       OR ch.badge_label ILIKE ANY(:alias_patterns)
       OR ch.division_league ILIKE ANY(:alias_patterns))
  -- level=junior → require a JUNIOR_MARKER in the row text;
  -- level=senior → require its absence.
```

Tournament filters run the same shape over `entry_type IN
('national_team','tournament','achievement')` using tournament aliases.

```sql
-- SELF-DESCRIBED tier (secondary signal, clearly labelled).
SELECT id FROM profiles
WHERE bio ILIKE '%<nt marker>%' AND bio ILIKE ANY(:alias_patterns)
```

**Step B:** pass the verified+self-described id-set into the existing RPC
via a **new NULL-neutral param** `p_restrict_profile_ids uuid[]` (one
migration; identical pattern to every previously added param — when NULL
the RPC is unchanged). This keeps every existing fence (hidden profiles,
test accounts, blocks, category routing, pagination) — no side path.

**Provenance map** (`profile_id → 'verified' | 'self_described'`) rides
along in nl-search memory; each returned result gets a `provenance` field
plus the matched entry text for the verified label (e.g. *"Italian National
Team · Goalkeeper · Jul 2023–present"*).

**Ordering:** verified first, then self-described. Nationality-only
profiles are **never** in the result set when the filter is present.

## 7. Honesty contract — in the composer, in code

`ai_message` for this intent is **assembled in TypeScript**, not delegated
to the LLM summary (the incident showed the summary narrates whatever the
filters did, including the wrong thing):

- **Verified results:** "N with verified {Country} national-team entries in
  their career history." Verified cards carry the matched entry line.
- **Self-described:** always labelled — "mentions the {Country} national
  team in their bio — not verified."
- **Zero for both:** exact shape from the brief, with a live count:
  *"No players with verified Argentina national-team experience yet.
  12 Argentine players are on HOCKIA — want to see them, or should I flag
  ones whose bios mention the national team?"* The nationality count is a
  cheap COUNT query; the pivots are suggested-action chips (existing
  mechanism), so choosing one is an explicit user action — we never
  silently substitute passport for caps.

## 8. Founder decisions needed BEFORE building

1. **Provincial/state selections** (Buenos Aires, Victoria, Wellington):
   NOT national-team matches in v1 — they simply won't alias-match a
   country at high confidence. Confirm this is the intended line.
2. **Masters national teams** ("England Masters O35"): count as verified
   senior but labelled "Masters", or exclude? **Recommendation: include,
   labelled** — it is representative experience; hiding it is padding's
   opposite error.
3. **The RPC migration** (`p_restrict_profile_ids`, NULL-neutral) touches
   `discover_profiles` — prod DB migration, staging first. Confirm.
4. **ES coverage** in v1 is deterministic-rules-first (the LLM prompt stays
   EN; Gemini parses ES queries fine and the rules re-bind). Confirm
   acceptable for v1.
5. **Zero-state copy** in §7 — confirm wording.

## 9. Files touched

| File | Change |
|---|---|
| `supabase/functions/_shared/international-taxonomy.ts` | NEW — taxonomy + markers + alias matcher |
| `supabase/functions/_shared/international-taxonomy.test.ts` | NEW — unit tests |
| `supabase/functions/_shared/llm-client.ts` | `ParsedFilters.international_experience` + tool-schema property + prompt note |
| `supabase/functions/_shared/intent-router.ts` | NT-marker signal; block world-club hijack |
| `supabase/functions/nl-search/index.ts` | deterministic binding; Step A queries; provenance; composer; `_meta` logging |
| `supabase/functions/nl-search/international-experience.eval.test.ts` | NEW — the eval suite |
| `supabase/migrations/<ts>_discover_profiles_restrict_ids.sql` | NULL-neutral `p_restrict_profile_ids` |
| staging-only seed (SQL, `[QA]` fixtures) | ~8 NT rows covering every match class |

## 10. Eval set (written FIRST, must pass before ship)

Offline (deno test, deterministic layer + SQL builder):

| Query | Assert |
|---|---|
| "I'm looking for players who played in the Argentina national team" *(incident, verbatim)* | `international_experience.countries=["Argentina"]`; `nationalities` does NOT contain Argentina; roles=[player] |
| "jugadoras que hayan jugado en la selección de España" | ie.countries=["Spain"]; category adult_women |
| "coaches with Olympic experience" | roles=[coach]; tournaments=[olympics] |
| "anyone who played a Junior World Cup" | tournaments=[junior_world_cup]; level=junior |
| "forwards who played Hockey One in Australia" | tournaments=[hockey_one]; positions=[forward] |
| "midfielders with EuroHockey experience" | tournaments=[eurohockey]; positions=[midfielder] |
| "Argentine defenders who played for the Spain national team" | nationalities=[Argentina] AND ie.countries=[Spain] *(the coexistence case)* |
| "players from Argentina" *(control)* | nationalities=[Argentina]; NO international_experience |
| "Are there any Argentina selection national team in the app?" *(incident #2)* | router does NOT select world_club_search |

Live (staging, then prod): same queries against the deployed function,
asserting parsed_filters + per-result provenance; the Argentina query must
return the honest zero (prod truth per §2) — never a nationality-only row.

## 11. Instrumentation

`parsed_filters.international_experience` logged as-is (it lives inside the
same JSON). `_meta` additions: `intl_binding_source`,
`intl_verified_count`, `intl_self_described_count`, router signal
`national_team`. Hit-rate on the intent class is then one SQL query over
`discovery_events`.

## 12. Deploy discipline

`nl-search` is pinned `verify_jwt=false` in **both** the project
`supabase/config.toml` (line 387) and its local config — matches prod
(verified via management API this session). Deploy per the standing note in
`docs/verify_jwt_drift_nl_search.md` (`--no-verify-jwt`). Order: staging DB
migration → staging deploy → eval suite on staging → prod DB migration →
FF merge → prod deploy → eval suite on prod → report before/after for the
incident query.

Known gap flagged: the `_shared` deno tests are not wired into CI. The eval
suite will be runnable with one command (`deno test`); adding a CI job is a
recommended follow-up in this PR's description, not scope creep inside it.
