# Cloudflare Stream — staging/prod isolation

## The video pipeline
Native player videos (`player_videos`, Cloudflare Stream) use three edge functions:

| Function | Secret(s) | verify_jwt |
|---|---|---|
| `video-create-upload` | `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN` | false (verifies JWT in-handler; player-only) |
| `video-webhook` | `CF_STREAM_WEBHOOK_SECRET` | false (called by Cloudflare, verifies HMAC signature) |
| `video-playback-token` | `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN` | false (optional auth; anon allowed for public) |

Flow: create-upload mints a Cloudflare tus upload + inserts `player_videos` at `pending_upload` (tagging the Cloudflare asset with `meta.hockiaVideoId = <row id>`) → client uploads the bytes straight to Cloudflare → Cloudflare transcodes → **the account's ONE webhook URL** fires → `video-webhook` flips the row to `ready` (+ `playback_id`, `thumbnail_url`, `duration`). Playback URLs/posters are minted per-view by `video-playback-token` against `requireSignedURLs` assets — no URL is ever stored.

## ⚠ KNOWN ISSUE (found 2026-07-09): staging shares PROD's Cloudflare account

Staging (`ivjkdaylalhsteyyclvl`) and prod (`xtertgftujnebubxgqit`) have **byte-identical** `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`, and `CF_STREAM_WEBHOOK_SECRET` — i.e. **staging is pointed at prod's Cloudflare Stream account**.

Cloudflare Stream allows **one webhook URL per account**, and it points at **prod's** `video-webhook` (prod is live). Consequences of a **staging** upload:

1. It creates a Cloudflare asset **in prod's account** (consumes prod Stream storage/delivery minutes + clutter).
2. Its transcode-`ready` webhook fires to **prod's** `video-webhook`, which looks up the row by `meta.hockiaVideoId` in the **prod** DB → not found → 0 rows updated.
3. The **staging** `player_videos` row stays `pending_upload` forever → never `ready` → no `video_added` Home/Pulse card → no playback.

So staging video uploads are **orphaned** *and* **bill into prod**. This is why staging shows zero videos and video playback is untestable there. The `video_added` render/playback code itself is correct (same `NativeVideoPlayer` proven on prod).

### Tier 1 — QA workaround (no infra change)
Do one native upload on staging (as a **public** video), then manually simulate the webhook on the staging row:
`UPDATE player_videos SET status='ready', playback_id=cf_uid WHERE id=<row>;`
The `video_added` trigger fires → card generates → `video-playback-token` mints a signed token for the real `cf_uid` (which exists in the shared account) → the card plays. Proves the chain without fixing the webhook.

### Tier 2 — Proper fix (separate staging Cloudflare account)
Give staging its **own** Cloudflare Stream account/token/webhook, then set staging's three CF secrets to that account:
```
supabase secrets set CF_ACCOUNT_ID=<staging> CF_STREAM_API_TOKEN=<staging> \
  CF_STREAM_WEBHOOK_SECRET=<staging> --project-ref ivjkdaylalhsteyyclvl
```
Point the new account's Stream webhook at `https://ivjkdaylalhsteyyclvl.supabase.co/functions/v1/video-webhook`.

**Never repoint the PROD Cloudflare webhook to staging** — it would orphan live prod uploads.
