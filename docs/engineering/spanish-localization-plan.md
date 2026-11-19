# Spanish localization plan (English + Spanish interface)

Date: 2026-11-15. Source: Claude Code planning session, repository survey of `staging` at `d944c792`.
Status: **plan only**. Nothing here is implemented, no migration is written, production is untouched.

The request: members should be able to use the app in Spanish as well as English.

How to read this document: section 1 and 2 say what exists today, section 3 to 6 say what to build and in what order, section 7 lists the decisions that belong to the founder. Every number is marked as **measured** (a command was run against this checkout) or **assumed** (an estimate that Stage 0 must confirm).

---

## 0. Summary

- The app has **no localization of any kind** today: no i18n library, no locale detection, no translated copy, no language preference in the database. English is written directly into about 770 source files.
- Member-facing copy in the client is roughly **9,400 strings, 42,000 words** (admin excluded). A further layer lives on the server: 21 email-sending functions, the push payload builder, 7 AI functions, 5 database email templates and 2 auth email templates.
- About **four in ten members who stated a nationality come from a Spanish-speaking country**, most of them from Argentina (measured on production, read-only aggregate, 2026-11-15). The value is real and concentrated.
- Recommended approach: `i18next` + `react-i18next`, one catalog per product area, English kept in the JS next to each lazy screen, Spanish loaded on demand as JSON, a language preference stored on the profile so the server can write emails and pushes in the same language.
- Recommended first release: an **opt-in "Español (beta)"** covering the full path a player or coach walks (sign up, onboarding, Home, Opportunities, applying, the language switch). About 2,700 strings.
- Installed store apps cannot receive any of the interface work by web deploy. Spanish reaches iOS and Android users only with a store build.
- Admin stays English.

---

## 1. Current state of the React client

### 1.1 Localization machinery (measured)

| Check | Result |
|---|---|
| i18n library in `client/package.json` | None (`i18next`, `react-intl`, `lingui`, `formatjs` all absent) |
| `navigator.language` / `navigator.languages` in `client/src` | 0 uses |
| `Intl.NumberFormat`, `Intl.PluralRules`, `Intl.RelativeTimeFormat`, `Intl.ListFormat` | 0 uses |
| `Intl.DateTimeFormat` | 1 file |
| Language column on `profiles` or anywhere in `supabase/migrations` | None. `profiles.languages` exists but means "languages this umpire speaks", not the interface language |
| `client/index.html` | `<html lang="en" translate="no">`; JSON-LD says `"inLanguage":"en"` |
| `hreflang`, `og:locale` | None |

`translate="no"` matters today: it tells Chrome and Safari not to offer automatic page translation, so a Spanish speaker currently has no fallback at all. It should stay (machine translation of a React DOM causes crashes), which is one more reason to ship real Spanish.

### 1.2 How much English copy there is (measured, rough)

Method: a script parsed every `.ts`/`.tsx` file under `client/src` (tests and generated types excluded) with the TypeScript compiler and counted three things: text inside JSX, copy-carrying JSX attributes (`placeholder`, `title`, `aria-label`, `alt`, `label` and similar), and string or template literals that read like a sentence. Files were assigned to an area by path. Class names, imports, log calls and thrown errors were filtered out.

Limits of the method: the "literal" column over-counts (some sentences are never shown to a member) and the area split is by file path, so a shared component lands in one area only. Treat each figure as accurate to about ±20%.

| Area | Files with copy | JSX text | Attributes | Literals | Strings | Words |
|---|---:|---:|---:|---:|---:|---:|
| Admin (stays English) | 101 | 1,580 | 507 | 811 | 2,898 | 10,796 |
| Profile (all roles, references, media, journey) | 137 | 673 | 390 | 1,279 | 2,342 | 9,305 |
| Community and World | 114 | 496 | 183 | 911 | 1,590 | 6,653 |
| Opportunities and applications (both sides) | 76 | 384 | 132 | 711 | 1,227 | 4,984 |
| Shared components and helpers | 131 | 166 | 63 | 639 | 868 | 3,874 |
| Brands and marketplace | 43 | 272 | 149 | 355 | 776 | 3,182 |
| Settings and legal (Terms and Privacy are 701 lines) | 13 | 332 | 74 | 91 | 497 | 4,473 |
| Home and dashboards | 44 | 124 | 57 | 246 | 427 | 1,623 |
| Auth | 30 | 144 | 22 | 226 | 392 | 2,042 |
| Hockia AI (client side) | 26 | 98 | 35 | 247 | 380 | 1,922 |
| Inbox, messages, notifications | 32 | 62 | 36 | 255 | 353 | 1,451 |
| Onboarding | 12 | 104 | 73 | 143 | 320 | 1,369 |
| Landing and public pages | 15 | 150 | 23 | 100 | 273 | 1,294 |
| **Total** | **774 of 1,069** | | | | **12,343** | **52,968** |
| **Member-facing (total minus admin)** | 673 | | | | **about 9,400** | **about 42,000** |

### 1.3 Helpers that already centralize copy (measured)

`docs/engineering/standards.md` section 3 requires status labels and copy to come from shared helpers. These are the natural first catalogs because the wording rules are already in one place:

| File | Lines | What it owns |
|---|---:|---|
| `client/src/lib/opportunityCopy.ts` | 429 | Player-facing Opportunities wording, benefits, skills, deadlines |
| `client/src/lib/applicationStatus.ts` | 279 | `APPLICATION_STATUS_LABELS`, one set of words per status |
| `client/src/lib/hockeyCategories.ts` | 188 | Playing categories |
| `client/src/lib/coachRoles.ts` | 146 | Coach specializations |
| `client/src/lib/roleLifecycle.ts`, `roleWaiting.ts` | 119, 90 | Role state wording |
| `client/src/lib/availabilityLabel.ts` | 94 | Availability pills |
| `client/src/lib/careerCopy.ts`, `attributionLabels.ts`, `nationality.ts` | 78, 64, 59 | Career, attribution, nationality lines |
| `client/src/lib/statusTone.ts` | 56 | Tone (colour) rules; little copy, but coupled to the labels |
| `clubProfileCopy.ts`, `clubSettingsCopy.ts`, `clubInviteCopy.ts`, `clubSquadCopy.ts`, `networkCopy.ts`, `videoCopy.ts`, `backLabel.ts` | 6 to 45 each | Small per-surface copy tables |
| `inboxTime.ts`, `friendshipErrors.ts`, `oauthErrorMessage.ts`, `supabaseErrors.ts` | 17 to 43 each | Relative time and error messages |
| `client/src/components/notifications/config.ts` | 541 | In-app notification text per notification kind (rendered on the client, so a language switch re-renders old notifications too) |
| `client/src/lib/identity.ts` (`humanizeToken`, `positionLabel`) | | Turns database tokens such as `head_coach` into "Head coach" by string manipulation. This cannot produce Spanish; every such token needs a catalog entry |

Important property: these helpers are plain functions called outside React components. The chosen library must offer a translate function that works without a hook.

### 1.4 Dates, numbers, plurals (measured)

| Pattern | Hits | Files | Consequence |
|---|---:|---:|---|
| `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` | 125 | 62 | Mixed: some pass `'en-US'`/`'en-GB'` (18 hits in 15 files), the rest use the device default, so output is already inconsistent between devices |
| `date-fns` imports (`format`, `formatDistanceToNow`, `isToday`, ...) | 15 | 15 | `formatDistanceToNow` and `format` need the `es` locale object passed in |
| Hand-built plurals (`count === 1 ? '' : 's'` and variants) | 103 | 69 | Must become plural-aware messages; Spanish plural is not "add s" and word order changes |
| Middle dot `·` as a separator | 1,283 | 347 | Language-neutral, no translation work; noted because joins like `[pos, team].join(' · ')` must keep working with translated parts |

---

## 2. Everything outside the React UI that carries language

### 2.1 Edge functions (measured: 45 function folders, 17,260 lines of `index.ts`)

**Transactional and digest emails.** 21 functions send through Resend: `notify-application`, `notify-application-status`, `notify-application-digest`, `notify-application-expiry`, `notify-vacancy`, `notify-friend-request`, `notify-message-digest`, `notify-onboarding-reminder`, `notify-opportunity-renewal`, `notify-profile-views`, `notify-reference-request`, `notify-reference-response`, `notify-reference-reminder`, `notify-feedback-submitted`, `notify-age-gate`, `club-reminders`, `admin-send-campaign`, `admin-market-digest`, plus test variants. The text is in two places:

- Code templates in `supabase/functions/_shared/`: `application-email.ts`, `vacancy-email.ts`, `friend-request-email.ts`, `message-digest-email.ts`, `reference-request-email.ts`, `reference-response-email.ts`, `reference-reminder-email.ts`, `profile-views-email.ts`, `club-reminder-email.ts`, `email-brand.ts`.
- Database templates in `email_templates`, rendered by `_shared/email-renderer.ts`. Keys found in migrations: `vacancy_notification`, `application_status`, `onboarding_reminder`, `profile_view_digest`, `outreach_introduction`. The table has no locale dimension.
- At least one hard-coded date locale: `notify-age-gate/index.ts:229` uses `'en-US'`.

**Auth emails.** `supabase/templates/confirmation.html` and `recovery.html`, wired in `supabase/config.toml`. One template per project, English. Assumed (to verify in Stage 2): the Supabase template language can branch on user metadata, which would allow one bilingual template file.

**Push notifications.** Text is built at send time in `supabase/functions/send-push/push-payload.ts` (556 lines, 73 `title:`/`body:` lines) and in `_shared/club-reminders.ts` for grouped club pushes. Triggered by a database webhook on `profile_notifications`. No SQL migration writes push text (measured: 0 matches), which is good: the language can be decided in one place.

**Hockia AI.** Seven LLM functions through `_shared/llm-client.ts`: `nl-search` (4,903 lines), `ai-opinion` (1,113), `application-feedback`, `role-description-draft`, `profile-builder`, `apply-draft`, `profile-bio`.

- Understanding Spanish input is partly there already: `llm-client.ts:460` maps Spanish position words (arquero, defensor, volante, delantero...) to the English enum, `nl-search/index.ts` has Spanish synonym tables (lines 242, 300) and Spanish router phrases (line 946), `_shared/intent-router.ts` has 8 Spanish references.
- Answering in Spanish is not: prompts do not state an output language, and `_shared/profile-bio.ts:30` says "The language is English unless the member's instruction asks otherwise".
- Fixed (non-LLM) answer text, rough count of sentence-like literals: `nl-search/index.ts` 55, `_shared/hockia-features.ts` 16, `_shared/clarifying.ts` 14, `_shared/suggested-actions.ts` 12, `_shared/role-ask.ts` 9, `_shared/member-goal.ts` 9.
- `supabase/functions/nl-search` is being released today (PR 552). This plan schedules AI work for Stage 3 and does not touch it before then.

### 2.2 Database-stored labels (measured)

| Data | Where | Spanish approach |
|---|---|---|
| Country names | `countries.name`, `common_name` (English). 80 client references to `nationality_name`/`common_name` | No schema change: derive from the ISO code with `Intl.DisplayNames('es', { type: 'region' })` |
| Demonyms | `countries.nationality_name` ("Argentine") | Spanish demonyms are gendered (argentino/argentina). Recommended: show "Nacionalidad: Argentina" (the country name) in Spanish instead of a demonym |
| Positions, coach specializations, categories, opportunity types, statuses | Stored as English enum tokens (`midfielder`, `head_coach`) | Tokens stay as they are. Labels come from catalogs keyed by token; `humanizeToken` remains only as a last-resort fallback |
| Clubs, leagues, provinces (`world_clubs`, `world_leagues`, `world_provinces`) | Proper names | Not translated |
| Member-written content: bios, posts, messages, role descriptions, references | User text | Not translated. Showing a "translate" action is a separate product idea, out of scope here |
| `email_templates` | 5 keys, English | Needs a locale column (migration, shown before applying) |

### 2.3 Native shells (measured)

- **iOS** (`client/ios/App/App/Info.plist`): `CFBundleDevelopmentRegion` is `en`; `knownRegions` in the Xcode project is `en, Base`; no `es.lproj`. Four permission strings are English: camera, microphone, photo library, photo library add.
- **Android** (`client/android/app/src/main/res`): only `values/strings.xml` (app name and scheme). No `values-es`. Android permission dialogs are system-provided and already follow the device language.
- **Assumed, must be verified on the device lab before Stage 1 ships**: inside a WKWebView, the language the web code sees (`navigator.language`, default `Intl` locale) follows the localizations the app bundle declares, not only the device setting. With an English-only bundle, an iPhone set to Spanish is expected to report English to the web code. If confirmed, automatic device-language detection on iOS needs `es` declared in the bundle, which is a store build.
- **Store listings**: not in the repository (no fastlane or metadata folder). They are managed by hand in App Store Connect and Play Console. See decision D3.

### 2.4 Landing and SEO pages (measured)

- `client/scripts/prerender-landing.mjs` (198 lines) prerenders the landing page into `dist/index.html` at build time, English only. `app.html` is the app shell.
- Route metadata in `client/src/lib/seo/` (`routeMeta.ts`, `applyRouteMeta.ts`, `opportunityHead.ts`, `worldHead.ts`).
- Edge functions `sitemap` and `public-opportunities` have no language handling.
- A Spanish landing page would need its own URL (for example `/es/`), `hreflang` pairs and a sitemap entry. That is public content, so it falls under decision D3.

### 2.5 Tests that assert English (measured)

| Suite | Size | English assertions | Plan |
|---|---|---|---|
| Vitest (`client/src/__tests__`, co-located tests) | 390 test files | 2,472 text queries in 190 files | Tests keep running in English: the test setup initializes the library with the English catalog synchronously. No mass rewrite |
| Playwright (`client/e2e`) | 29 spec files, 17 with `@smoke` | 326 text locators in 27 files; 140 test-id locators | `playwright.config.ts` sets no locale, so the browser default is English. Pin `locale: 'en-US'` explicitly so a future default change cannot flip the suite; add a small Spanish smoke spec |
| Edge function tests (`supabase/functions/_shared/*.test.ts`) | 39 files | 883 assertions, many on text | Locale becomes an optional parameter defaulting to English, so existing tests stay green |
| Device lab (`tools/devicelab/run.mjs`) | 1 script | 0 text selectors found | Add one run with the simulator language set to Spanish |

The known baseline of stale E2E specs (see `testing.md`) is unchanged by this plan: compare against the previous run, do not expect a fully green full suite.

---

## 3. Recommended approach

### 3.1 Library

**Recommendation: `i18next` + `react-i18next`.**

| Option | For | Against |
|---|---|---|
| **`i18next` + `react-i18next`** (recommended) | Works outside React (`i18n.t`) which the `lib/*Copy.ts` helpers need; namespaces map onto the existing lazy routes; built-in fallback chain (`es-AR` then `es` then `en`); plural rules from `Intl.PluralRules`; typed keys through TypeScript; a maintained ESLint plugin for un-translated literals; very widely known, which matters when many agent sessions touch the code | Runtime size (assumed 15 to 22 KB gzip in the first load); string keys cannot be minified, so each translated string adds its key twice to the raw total |
| Lingui | Compiles messages and shortens ids, so the smallest raw and first-load cost; strict "missing translation" compile step | Needs a compile-time macro transform in the build; the client builds with `rolldown-vite` and compatibility is unproven here. A build-pipeline risk for a size gain |
| FormatJS / `react-intl` | ICU message syntax, strong plural and gender support | Hook and component centred, awkward for the plain-function helpers; larger runtime |
| Small in-house `t()` over typed objects | Near-zero runtime, full control | We would rebuild plurals, fallback, lazy loading, extraction and lint ourselves, and own it forever |

Stage 0 includes a measured comparison of the first option against Lingui on one area before the choice is final, because the bundle gates are tight (section 3.6).

### 3.2 Catalog layout and key naming

- One namespace per product area, matching the lazy routes: `common` (shell, navigation, buttons, errors), `auth`, `onboarding`, `home`, `opportunities`, `applications`, `profile`, `community`, `world`, `inbox`, `notifications`, `ai`, `club`, `brands`, `settings`, `legal`, `enums` (positions, categories, statuses, benefits).
- Files: `client/src/locales/en/<namespace>.ts` (typed, the source of truth) and `client/src/locales/es/<namespace>.json`.
- Keys are structural and stable, not the English sentence: `opportunities.detail.applyButton`, `applications.status.shortlisted`, `enums.position.midfielder`. Three levels at most. A key is never reused for two places that merely happen to share English wording, because Spanish may need two different translations.
- Plurals use the library's plural suffixes (`_one`, `_other`; Spanish also has `_many` for millions). Variables are named (`{{clubName}}`), never positional. No sentence is assembled by concatenating translated fragments.
- The existing helpers stay as the single owner of their wording rules; they return catalog lookups instead of literals. `APPLICATION_STATUS_LABELS` becomes a function of the active language.

### 3.3 How the language is chosen

Resolution order, first match wins:

1. The member's saved choice: a new nullable column `profiles.ui_language` (`'en'`, `'es'`, or null for "follow my device").
2. A choice made before signing in, kept in `localStorage` and copied to the profile at sign-up.
3. The device language list (`navigator.languages`): any `es-*` selects Spanish.
4. English.

A language switch lives in Settings and on the sign-in / welcome screens (a Spanish speaker must be able to find it before reading any English).

Why the profile column and not only local storage: the server needs it. Emails and pushes are written when the member is not in the app. The column is also the gate that keeps Spanish server text away from members who never opted in.

Migration notes for when this is built (not written yet): `profiles` uses column-level SELECT grants, so the migration must include `GRANT SELECT (ui_language) ON public.profiles TO authenticated;`, a rollback file, and a check constraint on the allowed values. The column is additive, so old installed clients are unaffected.

Alternatives: setting only, no device detection (simplest, but most Spanish speakers never open Settings); device only, no setting (no escape when detection is wrong, and nothing for the server to read). Decision D2.

### 3.4 Fallback

- A key missing in Spanish renders the English string, never the raw key, and reports once per key to Sentry so gaps are visible.
- A Spanish catalog that fails to load leaves the screen in English rather than blank.
- CI makes the first case rare (section 5.4).

### 3.5 Lazy loading

- English strings stay in JS and are imported by the screen that uses them, so they travel in that screen's existing lazy chunk. English users pay no extra request and have no new failure mode.
- Spanish namespaces are JSON files requested on demand, in parallel with the lazy screen chunk. `common` and `auth` are requested at start-up when the language is Spanish.
- The service worker precache pattern in `client/vite.config.ts` (`**/*.{js,css,html,ico,svg,woff2}`) does not include JSON; the Spanish files need adding so Spanish works offline on the web.
- On native, the JSON files are inside the app bundle (Capacitor copies `dist`), so loading is local and instant.

### 3.6 Effect on the bundle budgets

Budgets from `standards.md` section 2 and `.github/workflows/ci.yml`:

| Gate | Limit | Last recorded value | Room |
|---|---|---|---|
| Initial-load JS, gzip | 560 KB (warning 520 KB) | 511 KB (CI comment dated 2026-11-11) | 9 KB to the warning, 49 KB to the limit |
| Raw JS across all chunks | 5,800 KB (warning 5,700 KB) | Not re-measured today. Headroom was about 11 KB on 2026-11-11 against the previous 5,500 KB limit, before the limit was raised to absorb library updates of about +165 KB | Assumed roughly 100 to 150 KB |

Expected cost (all assumed until Stage 0 measures it with a clean build, `SENTRY_AUTH_TOKEN= npm run build` and no env files):

- **Initial load**: library runtime plus the `common` English namespace, 20 to 30 KB gzip. This crosses the 520 KB warning and stays under the 560 KB limit. It does not require raising the limit, but it uses more than half the remaining room.
- **Raw total**: the runtime (60 to 90 KB raw) plus key overhead. The CI gate sums `dist/assets/*.js`. Spanish JSON is not JS and does not count. English stays where it is, but each migrated string adds its key at the call site and in the catalog, about 50 bytes per string. Stage 1 (about 2,700 strings) is therefore about +135 KB plus the runtime; the full member surface about +470 KB.
- **Conclusion**: the raw limit will need a founder-approved raise during Stage 1, and again later. That is consistent with how the limit has been used (a backstop for our own code, raised with a written reason), but it is the founder's call. Decision D7. If the answer is no, the fallback is Lingui (short ids) or serving English from JSON too, each with its own cost (build risk, or a new failure mode for English users).

---

## 4. The native-bundle constraint

Installed iOS and Android apps run the JS that was bundled into their store build. A web deploy does not change them.

| Ships by web deploy (inhockia.com, PWA) | Ships by edge-function deploy (reaches every client at once) | Needs a store build |
|---|---|---|
| The i18n runtime, catalogs, the language switch, all translated screens, for browser and PWA users | Spanish emails, Spanish pushes, Spanish AI answers, the `ui_language` column | Any Spanish interface in the installed iOS and Android apps |
| Later wording fixes to Spanish on the web | Wording fixes to server text | iOS permission strings (`es.lproj/InfoPlist.strings`) and declaring `es` in the bundle (expected to be required for device-language detection, section 2.3) |
| | | Later wording fixes to Spanish in the apps, unless remote catalog refresh is added (below) |

Consequences for the plan:

1. **Server text is gated by `ui_language`.** A member gets Spanish emails or pushes only if their profile says `es`. Only a client that contains the feature can set it, so members on old store builds are never surprised. One accepted edge: a member who picks Spanish on the web and also has an old installed app gets Spanish pushes over an English app until they update.
2. **No breaking API change is needed.** Every server change is additive: a new nullable column, an optional `locale` field in AI requests (old clients omit it and get English). `app_version_requirements.min_version` does not need to move.
3. **Most Hockia members use the store apps**, so Stage 1 is only real for them once a store build ships. Each stage therefore ends with a store build, or stages are grouped per build (decision D4).
4. **Optional later optimization, not in the first stages:** let the installed app check inhockia.com for a newer copy of a Spanish catalog and use it over the bundled one. This lets wording fixes reach the apps without a store build. New screens and new keys still need a build.

---

## 5. Translation workflow and quality

### 5.1 Who translates

1. A Claude Code session drafts each namespace from the English catalog, the glossary and the style guide, in the same PR that migrates the screens.
2. The founder (native Rioplatense speaker) reviews the high-visibility screens of each stage on staging in the actual app, not in a spreadsheet.
3. Optional: one paid professional review pass at the end of Stage 2 (about 42,000 words). This is a purchase and needs approval first. Decision D6.

### 5.2 Variant and tone

Evidence: about 44% of members with a stated nationality are from Spanish-speaking countries; about 40% of all stated nationalities are Argentina alone, Spain about 3% (production aggregate, 2026-11-15). The founder writes in Rioplatense Spanish.

Recommendation: **one `es` catalog in neutral Latin American Spanish, written so the "vos or tú" question rarely arises**: buttons and labels in the infinitive ("Enviar postulación", "Completar perfil"), statements instead of commands where possible. Hockey vocabulary follows Argentine usage where regions differ, because that is where the members are. The fallback chain leaves room for an `es-AR` or `es-ES` overlay later that overrides only the strings that differ. Decision D1.

### 5.3 Spanish equivalents of the design rules

The `hockia-design-rules` skill (`references/copy-privacy-safety.md`) says copy is English, sentence case, gender-neutral, plain, never promising outcomes. Spanish needs its own written rules, added to the skill in Stage 0:

- **Sentence case**: Spanish already uses it; only the first word and proper nouns are capitalized. Opening `¿` and `¡` are always used.
- **Gender-neutral**: harder, because nouns and adjectives carry gender. In order of preference: (1) rephrase around the person ("Perfil verificado", not "Estás verificado"; "Quienes se postularon", not "Los postulados"); (2) epicene or collective words ("deportista", "integrante", "el plantel", "la dirigencia"); (3) a visible doublet only for role names where nothing else works ("Jugador/a", "Entrenador/a", "Árbitro/a"). Never infer a member's gender from data to pick a form. No "x", "@" or "e" endings unless the founder decides otherwise. Decision D5.
- **Plain and specific**: same rule. Buttons say what happens, confirmations say what happened.
- **Never promise outcomes**: same rule, and translators must not soften or strengthen a claim. "May" stays "puede", not "va a".
- **Formality**: no "usted". Warm and direct.

### 5.4 Glossary (draft for founder review, not final)

| English | Spanish (proposed) | Note |
|---|---|---|
| Field hockey | Hockey sobre césped | Spain: "hockey hierba" |
| Player / Coach / Umpire / Club / Brand | Jugador/a / Entrenador/a / Árbitro/a / Club / Marca | Argentina also says "DT" |
| Goalkeeper / Defender / Midfielder / Forward | Arquero/a / Defensor/a / Volante / Delantero/a | Spain: "portero/a", "medio" |
| Opportunity, role | Oportunidad, búsqueda | To settle: "búsqueda", "vacante" or "puesto" |
| Apply, application | Postularse, postulación | Spain: "candidatura" |
| Shortlist | Preselección | |
| Trial | Prueba | |
| Reference | Referencia | |
| Penalty corner | Córner corto | |
| Drag flick | Arrastrada | Many players also say "drag flick" |
| Indoor | Indoor, hockey pista | |
| Home, Community, Inbox | Inicio, Comunidad, Mensajes | |
| Hockia AI | Hockia AI | Product name, not translated |

The glossary lives next to the catalogs (`client/src/locales/glossary.md`) and is the reference for every translation PR. Search keeps accepting all regional synonyms regardless of which word the interface shows.

### 5.5 Keeping untranslated strings out

1. **Lint**: `eslint-plugin-i18next` rule `no-literal-string`, set to error for folders that have been migrated and off elsewhere. The list of migrated folders only grows. Admin is permanently excluded.
2. **Catalog parity check in CI** (`client/scripts/check-locales.mjs`, new): every English key exists in Spanish, with the same variables and the plural forms Spanish needs; no empty values; no Spanish key without an English one. Fails the build.
3. **Pseudo-locale in development**: a generated locale that lengthens every string by about 30% and brackets it, to spot hard-coded text and overflow before translating.
4. **PR rule**, added to `standards.md` section 3: a PR that adds member-facing copy adds both languages.
5. **Edge functions**: same parity idea for the server catalogs, run in the existing "Edge Function Tests" job.

---

## 6. Staged rollout

Effort is rough, in working days of an engineering session including tests and review rounds. It assumes the founder reviews each stage on staging within a day or two.

| Stage | Content | Strings (approx.) | Effort | Ships by |
|---|---|---:|---|---|
| **0. Foundations** | Library decision confirmed by measurement; i18n set-up; language resolver; `profiles.ui_language` migration (shown first); date, number, plural and list helpers replacing the 125 `toLocale*` calls and 103 hand-built plurals incrementally; lint rule; parity check; pseudo-locale; Spanish copy rules and glossary agreed; device-lab check of what iOS reports as language | 0 visible | 3 to 4 days | Web deploy; nothing visible to members |
| **1. First value: the player and coach path** | `common` (navigation, buttons, errors), `auth`, `onboarding`, `home`, `opportunities`, `applications`, `enums`, the language switch | 2,700 | 8 to 10 days | Web deploy, then a store build with iOS `es` declared and permission strings |
| **2. The rest of daily use, plus server text** | `profile`, `community`, `world`, `inbox`, `notifications` (in-app config, push payload), transactional emails and the two auth emails, `email_templates` locale column (migration shown first), `settings` | 4,800 | 12 to 15 days | Web and edge deploy, store build |
| **3. Hockia AI, clubs, brands** | AI answers in the member's language and the fixed AI strings (`nl-search`, `role-ask`, `clarifying`, `suggested-actions`, `member-goal`, `hockia-features`, `profile-bio`, `apply-draft`, `application-feedback`, `ai-opinion`); club recruiting screens; brands and marketplace | 2,400 | 8 to 10 days | Edge and web deploy, store build |
| **4. Public surface (only if decided)** | Store listings, Spanish landing page with `hreflang`, legal pages | 1,300 plus listings | 3 to 5 days plus store review | Depends on D3 and D8 |

Total for stages 0 to 3: about 31 to 39 working days. Admin is not translated.

### 6.1 Why this first stage

A half-translated app feels broken, so the smallest stage that is worth shipping is one complete journey, not a scattering of screens. The journey chosen is the one most members are on and the one with the clearest outcome: sign up, set up, see roles, apply. It is released as an **opt-in "Español (beta)"** in Settings and on the welcome screen, with a short note that some screens are still in English. Device-language auto-selection is switched on only when Stage 2 is done, so nobody lands in a mixed app without choosing it. Decision D4.

A smaller alternative exists (auth and onboarding only, about 700 strings, 3 to 4 days). It helps sign-up conversion for Spanish speakers but drops them into an English app right after, which is why it is not recommended.

### 6.2 Risks

| Risk | Mitigation |
|---|---|
| Spanish text is 15 to 30% longer and breaks tight phone layouts (tab bars, pills, one-line buttons) | Pseudo-locale in Stage 0; screenshots of each migrated screen in Spanish at phone width before merge; device-lab run in Spanish |
| Raw bundle limit blocks the work | Measured in Stage 0; decision D7 taken before Stage 1 starts |
| Mixed-language experience during the rollout | Opt-in beta label; whole journeys per stage; auto-selection only after Stage 2 |
| Test churn across 2,472 unit and 326 E2E text assertions | Tests stay in English by construction; parity and Spanish smoke tests are additions, not rewrites |
| English and Spanish drift apart as copy changes | Lint, parity check, PR rule (section 5.5) |
| AI answers drift between languages or mix them | Output language stated in the system prompt from the request's `locale`; deterministic fixed strings come from catalogs, not the model; evaluation set of Spanish questions added to the existing nl-search tests |
| Copy rules weaken in translation (promising outcomes, gendered wording) | Spanish rules written into the design-rules skill before any translation; founder review per stage |
| Legal text: a translated Terms or Privacy page can create obligations | Not translated without a decision (D8). Default: English legal pages with a Spanish notice that the English version governs |
| The public-content rule (all public Hockia content in English) collides with Spanish store listings, landing pages, emails | Nothing public is translated without decision D3 |
| Old store builds receive Spanish server text | Gated on `ui_language`, which old builds cannot set |
| Wrong assumption about iOS language detection | Verified on the device lab in Stage 0, before anything depends on it |
| Regional vocabulary reads wrong to part of the audience | Glossary reviewed by the founder; overlay locales possible later; search accepts all synonyms |

### 6.3 What is measured

- **Adoption**: share of active members with Spanish active, split by "chose it" and "device default", per platform. Recorded as a person property in the existing analytics (`docs/engineering/analytics-tracking-plan.md` gets the new property).
- **Quality signal**: members who switch back from Spanish to English, and on which screen.
- **Outcome**: for members from Spanish-speaking countries, before and after each stage: sign-up completion, onboarding completion, first application sent, seven-day return. Compared against the same period for other members, with the caveat that the sample is a few hundred people, so only large differences mean anything.
- **Coverage**: missing-key events in Sentry (target zero), percentage of member-facing folders under the lint rule.
- **Email**: open and click rates by language from the Resend webhook data already stored.
- **Cost**: both bundle gates per stage; AI token cost per answer by language.

---

## 7. Decisions for the founder

Each has a recommendation; none is assumed.

**Decided by the founder on 2026-11-15 (in the planning session): D1 = A, D2 = A, D3 = A, D4 = A.** So: neutral Latin American Spanish with Argentine hockey vocabulary; device language plus a switch; emails and pushes follow the member's language while store listings and landing pages stay English; opt-in beta released stage by stage. **Still open: D5, D6, D7, D8.** D7 is best answered with the Stage 0 measurements.

**Update 2026-11-17 (founder, after reading the Spanish on staging):** device-language following is switched on (`AUTO_DETECT_DEVICE_LANGUAGE` in `client/src/i18n/languages.ts`). A saved or stored choice still wins. When the device puts a signed-in member's app in Spanish and they have no saved choice, the app saves `'es'` on the profile and the account (`LanguageBoundary`, `saveLanguageOnAccount`), so emails, pushes and Hockia AI match what they read. From then on it is their saved language on every device until they change it with the switch. The "Español (beta)" label and the beta note under the switch were removed the same day (founder decision). Country names and nationalities are shown in Spanish since the same day (`client/src/i18n/countryNames.ts`, table in `countryNamesEs.ts`, rules in `client/src/locales/glossary.md`): the stored English values are never changed, only translated when shown. Not covered: admin screens, public landing and SEO text (English by decision), server-written text (emails, pushes, Hockia AI answers), and names typed by members.

**Staging check 2026-11-17 (source: engineering session, a dedicated Spanish test player on staging, a Playwright browser with an `es-AR` locale and the device lab's small Android emulator).** Verified: the device language puts the app in Spanish on the web and in the Android app; a new account gets `ui_language = 'es'` on the profile and the account without touching the switch; sign-up, onboarding, Home, Community, Opportunities, the apply flow, Inbox and Settings read in Spanish; the in-app notification for a shortlisted application is Spanish; Hockia AI answers in Spanish. Fixed the same day: the country on My applications, the role tag in the apply sheet, the country on Hockia AI result cards, prepared Hockia AI prompts appearing in English in the member's bubble (`shown` on the chat message; the English prompt is still what Hockia AI reads, and a chat reopened from history shows the stored English prompt), and Hockia AI not understanding countries or team categories named in Spanish (`_shared/country-names-es.ts`, generated from the client table and kept equal by a test). Not verified: a delivered Spanish email (staging only sends to the addresses in `EMAIL_ALLOWED_RECIPIENTS`; the status-email function ran for the Spanish member and skipped the send) and a push on a device (the test account has no registered device). Open: staging sends Supabase's default English confirmation email, so the bilingual `supabase/templates/confirmation.html` and `recovery.html` are not applied to the staging project's auth settings; check production before release. Their subjects in `supabase/config.toml` are English only.

**Email check 2026-11-18 (source: engineering session, real emails sent from staging to the Spanish test player and read in Resend).** Delivered and read in Spanish: the message digest, the shortlisted email and the declined email. The staging recipient whitelist now includes the test player's address (founder approval). Found and fixed after a read-only audit of every member email in both languages: English country names shown to Spanish readers (suggested opportunities, new-opportunity email, club reminders); middle-dot and bullet separators in copy (a test now fails if one comes back, `_shared/email-polish.test.ts`); text versions that dropped sentences, links or the footer the HTML carries (status, expiry, weekly applications, renewal, age gate, club reminders); labels printed with nothing after them in text templates (`interpolateText`); greetings for members without a first name (`namelessGreeting`, never the email's local part); the friend-request and reference-request buttons, which pointed at routes the app does not have; the English "1 new messages" subject; upper-case brand name in English push text. Stored template rows are changed by migration `20261118120000_email_templates_polish.sql`. Auth emails: the confirmation and recovery templates and their subjects in `supabase/config.toml` are bilingual; they still have to be copied into each project's auth settings (they are not applied by a deploy). Known and left as is: the club's decline note reaches the applicant in the language the club wrote it in; a new or updated offer is emailed since `20261118160000_offer_email.sql` (founder decision 2026-11-18, in the application-status batch and only while the offer is still live), and its withdrawal since `20261119100000_offer_withdrawn_email.sql` (founder decision 2026-11-19, same batch, only when the offer itself had been emailed); the message digest counts typed messages only, so an offer card that shows as unread in the inbox is not in the email's count.

**D1. Which Spanish?**
- A. Neutral Latin American Spanish, hockey words as used in Argentina, phrased to avoid "vos / tú" (recommended). One catalog serves everyone; a regional overlay can be added later.
- B. Rioplatense with voseo. Closest to the largest group of members and to the founder's voice; reads as foreign in Spain and Mexico.
- C. Neutral with "tú" throughout. Standard for international apps; slightly distant for Argentine members.

**D2. How is the language chosen?**
- A. Follow the device language, with a switch in Settings and on the welcome screen (recommended, device-following switched on after Stage 2).
- B. Switch only; everyone starts in English. Simplest; most Spanish speakers will never find it.
- C. Ask every member once with a prompt. Highest awareness; one more interruption.

**D3. Where the "public content is always English" rule meets this work.** For each of store listings, landing and SEO pages, and emails and pushes:
- A. Emails and pushes follow the member's interface language (they are private messages to one member); store listings and landing pages stay English for now (recommended).
- B. Everything a member can see follows their language, including a Spanish store listing and a Spanish landing page.
- C. Only the in-app interface is translated; emails and pushes stay English.

**D4. How is it released?**
- A. Opt-in "Español (beta)" as each stage lands, one store build per stage (recommended). Members get value in weeks; some screens are English meanwhile.
- B. Wait until Stages 1 to 3 are complete and release once. Polished; no value for about two months.
- C. Web first as beta, a single store build after Stage 2. Fewer store reviews; app users wait longer.

**D5. Gender-neutral Spanish.**
- A. Rephrase to avoid gender; doublets ("Jugador/a") only for role names (recommended).
- B. Generic masculine ("Jugador", "Entrenadores"). Shortest; not neutral.
- C. Inclusive endings ("jugadorxs", "jugadores/as" everywhere). Explicit; divisive and harder to read.

**D6. Who reviews the translation?**
- A. Founder reviews key screens per stage on staging (recommended to start).
- B. A, plus one paid professional review at the end of Stage 2 (a purchase, needs approval).
- C. A, plus a volunteer member from Spain for regional checks.

**D7. Bundle budget.** The raw JS limit (5,800 KB) will be crossed during Stage 1 by an estimated 100 to 250 KB, and by about 500 KB over the whole project.
- A. Approve raises as each stage is measured, with the written reason, as done before (recommended).
- B. Hold the limit; use the compiled-message library instead (smaller, with build risk) and accept a longer Stage 0.
- C. Decide after Stage 0 produces real numbers.

**D8. Legal pages (Terms, Privacy).**
- A. Keep English, add a Spanish notice that the English version governs (recommended).
- B. Translate with professional or legal review.
- C. Translate as a convenience copy, marked as non-binding.

---

## Appendix: what was verified and what was not

Verified by running commands against this checkout on 2026-11-15: every count in sections 1 and 2, the absence of i18n machinery, the bundle limits in CI and `standards.md`, the native shell configuration, the test counts, and the production nationality aggregate (one read-only query, counts only).

Not verified, flagged as assumed in the text: library sizes; the current raw bundle total; the per-string key overhead; iOS WKWebView language behaviour; whether Supabase auth templates can branch on user metadata; Lingui compatibility with the `rolldown-vite` build; all effort estimates. Nothing was built, so no layout was checked in Spanish.
