# Hockia assistant connector (remote MCP server)

Lets a member connect an AI assistant (Claude first; founder decision 2026-11-24) to their own Hockia account, read only. A Cloudflare Worker; staging only so far.

## How it fits together

```
Claude ──MCP (Streamable HTTP)──▶ Worker /mcp ──member's own token──▶ Supabase RPC mcp_* (RLS, fences, limits)
   │                                  ▲
   └─OAuth 2.1 + PKCE─▶ Worker /authorize (consent for that assistant)
                          └─▶ Supabase OAuth server ─▶ Hockia sign-in + /oauth/consent ─▶ Worker /callback
```

- The Worker is the OAuth authorization server the assistants see (`@cloudflare/workers-oauth-provider`): Client ID Metadata Documents and dynamic registration, PKCE S256, RFC 9207 `iss`, tokens bound to `/mcp`.
- Members sign in on Hockia through the Supabase OAuth 2.1 server, where this Worker is the **only** registered client. Supabase dynamic registration stays off.
- The member's Supabase tokens live encrypted inside the grant (`props`). The assistant only ever holds a Worker token that works nowhere else.
- Every tool calls one `mcp_*` database function (migration `20261125100000`) with the member's token. The database applies the fences, the field lists and the per-member limits; the Worker removes links and invisible characters from member-written text (`src/sanitize.ts`).
- Worker tokens live 50 minutes, a little less than the Supabase session they carry; when the assistant refreshes, the Worker refreshes the Supabase session (`tokenExchangeCallback`). If Supabase refuses, the grant ends and the member connects again.
- Kill switch: `app_settings.mcp_connector_enabled` (absent = off), no deploy needed.

## Tools

`get_my_profile`, `search_opportunities`, `get_opportunity`, `list_my_applications`, `list_my_opportunities`, `list_applicants`, `search_members`, `get_member_profile`. All annotated read-only. Recruiter-only tools answer with a plain explanation to other members.

## Local checks

```sh
cd mcp-server
npm ci
npx tsc --noEmit
npx vitest run
npx wrangler dev   # .dev.vars with placeholder values; sign-in needs a real Supabase client
```

## Setting up staging (once)

Each step changes a shared account and needs the founder's go-ahead.

1. **Supabase (staging project)**, Dashboard > Authentication > OAuth Server: turn it on, authorization path `/oauth/consent`, dynamic registration **off**. Then register one client: name "Hockia connector", redirect URI `<PUBLIC_URL>/callback`, confidential. Do not use `supabase config push` (it overwrites hosted auth settings).
2. **Cloudflare**:
   ```sh
   set -a; . ~/.config/hockia/cloudflare.env; set +a   # CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
   cd mcp-server
   npx wrangler kv namespace create OAUTH_KV              # put the id in wrangler.jsonc
   npx wrangler secret put SUPABASE_ANON_KEY
   npx wrangler secret put SUPABASE_OAUTH_CLIENT_ID
   npx wrangler secret put SUPABASE_OAUTH_CLIENT_SECRET
   npx wrangler secret put CONSENT_SECRET                 # 32+ random characters
   npx wrangler deploy
   ```
   `PUBLIC_URL` in `wrangler.jsonc` and `ORIGIN` in `src/index.ts` must both be the deployed address.
3. **Database**: merge the migration and push it; then turn the switch on for staging only.
4. **Claude**: Settings > Connectors > Add custom connector, URL `<PUBLIC_URL>/mcp`.

Production needs its own Worker, its own Supabase client, and asymmetric JWT signing keys on the production project (it still uses the legacy key; checked 2026-11-25).

## Not done yet

- A "Connected assistants" screen in Hockia settings to see and revoke connections (the Worker can list and revoke grants; Supabase revocation is per client, so it would disconnect every assistant at once).
- Writes of any kind (later stage, separate decision).
