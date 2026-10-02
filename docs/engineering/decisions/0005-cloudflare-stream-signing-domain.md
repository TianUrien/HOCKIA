# ADR 0005: Cloudflare Stream playback - local signing on the customer subdomain

Status: accepted (customer subdomain 2026-09-19; local signing 2026-09-24).

## Context

Player videos are stored in Cloudflare Stream with signed URLs required. Two
problems appeared in production: some ISPs in the launch market interfere with
TLS to the generic `videodelivery.net` host, so feeds showed black videos; and
minting a token through Cloudflare's token API costs a network round trip per
video, which dominated thumbnail time on a cold profile.

## Decision

1. Every signed playback and thumbnail URL is built on the account's
   customer subdomain (`customer-<id>.cloudflarestream.com`), never on
   `videodelivery.net`. The delivery host is per Cloudflare account, so each
   environment uses its own.
2. Tokens are signed locally in the edge function with a Stream signing key
   (`CF_STREAM_KEY_ID`, `CF_STREAM_JWK`) as RS256 JWTs with the same claims
   as the token API; the token API remains the fallback when the secrets are
   absent.
3. No playback URL is stored; `video-playback-token` mints per view.

## Evidence

- `supabase/functions/_shared/stream-signing.ts` and its test.
- Commits `65d19677` ("serve signed Stream URLs from the customer subdomain,
  not videodelivery.net") and `f7535ea1` ("signed delivery host per
  Cloudflare account - staging video was dead").
- `supabase/functions/CLOUDFLARE_STREAM.md` for the pipeline and the
  staging/production account isolation issue.

## Consequences

- The CSP in `client/vercel.json` still lists `videodelivery.net`; it can be
  removed once no stored thumbnail references it.
- A trailing newline in the JWK secret breaks signing with 401; probe after
  setting secrets.
- Staging must have its own Stream account and webhook; verify the `CF_*`
  secrets differ between projects before relying on staging video tests.
