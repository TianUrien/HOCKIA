# ADR 0006: Public repository policy

Status: accepted (founder ruling 2026-09-26; CI controls earlier).

## Context

The repository was private for a short period in September 2026. A private
repository would exceed the free GitHub Actions allowance at the current CI
volume (several thousand minutes per month), and no new paid services are to
be added. The repository therefore stays public at least until the current
tracks are done, which raises the bar for what may be committed and how
changes are described.

## Decision

1. **Nothing sensitive in the tree**: no credentials, tokens, service keys,
   user data, real emails or user identifiers. Test fixtures use synthetic
   addresses.
2. **Neutral commit and PR text**: describe the change; never describe a
   vulnerability, an exploit path, a user or an incident in a way that could
   be used against the product.
3. **CI gates**: gitleaks on every push and PR over full history
   (`.gitleaks.toml`); `scripts/audit-check.mjs` fails on unlisted high or
   critical advisories with a time-boxed allowlist; CI artifacts expire after
   3 days.
4. **Scheduled monitoring off Actions**: uptime and synthetic HTTP checks run
   on a Cloudflare Worker; the GitHub workflows for them are manual-only.
5. **Security documentation describes controls, not exploit detail** (see
   security.md).

## Evidence

- `.gitleaks.toml`; `ci.yml` job "Security Checks" and `retention-days: 3`.
- `client/audit-allowlist.json` (empty, with the policy in its comment) and
  `client/scripts/audit-check.mjs`.
- `.github/workflows/uptime.yml` and `synthetic.yml` are `workflow_dispatch`
  only; `ops/uptime-worker/README.md` explains the move.
- Commit `fdabaabb` records the brief private period; project memory records
  the return to public and the 2026-09-26 key scan.

## Consequences

- The production anon key appears in a manual workflow and the staging URL
  in several docs; the anon key is publishable by design, but keeping it in a
  secret is cleaner. Test-account addresses in `docs/ENVIRONMENT_SETUP.md`
  and `client/.env.example` should be replaced with placeholders.
- Security findings are tracked outside the repository and referenced here
  only as named workstreams.
