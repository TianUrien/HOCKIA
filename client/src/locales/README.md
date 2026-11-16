# Interface catalogs

Added 2026-11-16 (Claude Code, Spanish localization Stage 0). Plan: `docs/engineering/spanish-localization-plan.md`.

- `en/<namespace>.json` is the source of truth. English catalogs are imported as JS by the code that uses them.
- `es/<namespace>.json` holds the Spanish text. It is fetched on demand and falls back to English key by key.
- One namespace per product area (`common`, `auth`, `onboarding`, `home`, `opportunities`, ...). A screen's namespace is registered next to the screen with `registerNamespace` from `@/i18n`.

## Adding or changing copy

1. Add the key to `en/<namespace>.json` and to `es/<namespace>.json` in the same PR.
2. Use it: `const { t } = useTranslation()` in components, `t` from `@/i18n` in plain functions.
3. When a file has no hard-coded copy left, add it to `I18N_MIGRATED` in `client/eslint.config.js`.
4. `npm run lint` runs the parity check (`scripts/check-locales.mjs`): missing keys, missing plural forms, empty values and changed variables fail.

## Key rules

- Keys describe the place, not the sentence: `notFound.title`, `applications.status.shortlisted`. Three levels at most.
- Never reuse a key for two places because the English happens to match.
- Named variables only (`{{clubName}}`). Never build a sentence by joining translated pieces.
- Plurals use suffixes: `roles_one`, `roles_other`. Spanish also needs `_many` (used for millions; usually the same text as `_other`).
- Dates, clock times, numbers and lists come from `@/i18n/format` or `lib/dayFirst`, never from hand-written month or separator tables.

## Trying it

- Spanish: `localStorage.setItem('hockia.uiLanguage', 'es')` and reload. Only migrated screens change.
- Pseudo-locale (development): run `__hockiaPseudoLocale()` in the console. Bracketed, accented, 30% longer text is translated; plain text is still hard-coded.

Writing rules for Spanish and the glossary: `glossary.md` in this folder and `.claude/skills/hockia-design-rules/references/copy-privacy-safety.md`.
