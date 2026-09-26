# HOCKIA uptime monitor (Cloudflare Worker)

Runs production monitoring on Cloudflare cron triggers instead of GitHub Actions:

- every 5 minutes: `functions/v1/health` must return 200; then the critical edge functions are warmed with CORS preflights
- every 6 hours: home page, opportunities page, `public-opportunities` and `sitemap` must answer as expected

Alerts go by email (Resend): one when a check starts failing, one when it recovers. The worker has no public URL (workers_dev = false); current state and last run times live in the STATE KV namespace (`npx wrangler kv key list --binding STATE`).

The browser smoke tests (`.github/workflows/synthetic.yml`) remain available as a manual GitHub workflow.

## Deploy

```sh
set -a; . ~/.config/hockia/cloudflare.env; set +a   # CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
cd ops/uptime-worker
npx wrangler kv namespace create STATE              # first time: put the id in wrangler.toml
npx wrangler secret put SUPABASE_ANON_KEY           # production anon key
npx wrangler secret put RESEND_API_KEY              # sending-only key for inhockia.com
npx wrangler secret put ALERT_TO                    # comma-separated recipients
npx wrangler deploy
```
