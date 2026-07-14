#!/usr/bin/env node
// M12 — guard against shipping a STAGING-baked native binary.
//
// `vite build` resolves env by mode, but on any machine/clone missing
// client/.env.production it silently falls back to client/.env (which points
// at STAGING), baking the wrong Supabase project into a store binary — the
// worst-case form of the 2026-07-07 native-compat incident. Since installed
// native apps pin their bundled JS, that binary would talk to staging for its
// whole lifetime in the field.
//
// This asserts the freshly built dist/ inlines the PRODUCTION Supabase
// endpoint and NOT the staging endpoint, and fails the build otherwise. We
// match the full "<ref>.supabase.co" ENDPOINT URL — not the bare ref, which
// legitimately appears as a getEnvironment() detection string even in a
// correct prod build.
import { readdirSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const PROD_ENDPOINT = 'xtertgftujnebubxgqit.supabase.co'
const STAGING_ENDPOINT = 'ivjkdaylalhsteyyclvl.supabase.co'

const here = dirname(fileURLToPath(import.meta.url))
const distAssets = resolve(here, '..', 'dist', 'assets')

let files
try {
  files = readdirSync(distAssets).filter((f) => f.endsWith('.js'))
} catch {
  console.error('[assert-prod-bundle] FAIL: dist/assets not found — run `vite build` first.')
  process.exit(1)
}

let sawProd = false
let sawStaging = false
for (const f of files) {
  const src = readFileSync(join(distAssets, f), 'utf8')
  if (src.includes(PROD_ENDPOINT)) sawProd = true
  if (src.includes(STAGING_ENDPOINT)) sawStaging = true
}

if (sawStaging) {
  console.error(
    `[assert-prod-bundle] FAIL: staging endpoint (${STAGING_ENDPOINT}) is baked into dist/. ` +
      'The build resolved staging env — refusing to package a staging binary. ' +
      'Ensure client/.env.production exists (it is gitignored) and rebuild.',
  )
  process.exit(1)
}
if (!sawProd) {
  console.error(
    `[assert-prod-bundle] FAIL: production endpoint (${PROD_ENDPOINT}) is NOT in dist/. ` +
      'The build did not inline the prod Supabase URL.',
  )
  process.exit(1)
}

console.log(`[assert-prod-bundle] OK: dist/ is prod-only (${PROD_ENDPOINT}; no staging endpoint).`)
