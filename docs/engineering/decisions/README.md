# Architecture decision records

Decisions that constrain future work and can be verified from the repository
or its history. Each record states the context, the decision, the evidence in
the tree, and the consequences. Status is `accepted` unless noted.

| ADR | Title | Evidence |
|---|---|---|
| [0001](0001-migrations-via-cli-with-rollbacks-and-probes.md) | Migrations are applied only with the Supabase CLI; each ships a rollback file and, when security-relevant, a self-reverting probe | `supabase/rollbacks/`, `supabase/tests/security/`, CI "Migration Validation" |
| [0002](0002-sql-functions-own-status-changes.md) | SQL SECURITY DEFINER functions own every status change in the recruiting pipeline; clients only read | `20260928110000_recruiting_invites_offers_schema.sql`, `20260926100000_phase1_close_client_write_holes.sql`, `client/src/lib/{invites,signing}.ts` |
| [0003](0003-explicit-visibility-fences-and-service-role-webhooks.md) | Hidden-profile fences are applied explicitly on every people-returning surface; webhook functions require a service-role caller | root `CLAUDE.md`, `profile_is_hidden`, `_shared/webhook-auth.ts` and its test |
| [0004](0004-bundle-budgets.md) | Initial-load gzip budget 480 KB is a hard, never-raised limit; raw total 4,800 KB is a founder-approved backstop | `.github/workflows/ci.yml` job "Build", `client/vite.config.ts` |
| [0005](0005-cloudflare-stream-signing-domain.md) | Signed Stream playback URLs are minted locally and served from the account's customer subdomain, never `videodelivery.net` | `_shared/stream-signing.ts`, commits `65d19677`, `f7535ea1` |
| [0006](0006-public-repository-policy.md) | The repository is public; commit text is neutral and nothing sensitive is committed; CI enforces secret and dependency gates | `.gitleaks.toml`, `scripts/audit-check.mjs`, `ci.yml` artifact retention |

## Writing a new ADR

File name `NNNN-short-title.md`. Sections: Context, Decision, Evidence,
Consequences, Alternatives considered (optional). Keep it under a page. Link
the ADR from the table above and from the standards or security document it
affects. Do not record decisions that cannot be verified from the repository
without labelling the unverified parts.
