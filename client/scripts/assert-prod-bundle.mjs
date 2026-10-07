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
//
// Second guard (release audit 2026-10-06): everything under client/public is
// copied verbatim into dist/ and from there into the store binaries. Stray
// files left there untracked (mockups, store artwork, icon sources) would ship
// to every user, so packaging is refused while `git status` lists untracked
// files in client/public. Tracked files are the intended set; move the rest
// out of the tree rather than adding them.
import { execFileSync } from 'child_process'
import { readdirSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const PROD_ENDPOINT = 'xtertgftujnebubxgqit.supabase.co'
const STAGING_ENDPOINT = 'ivjkdaylalhsteyyclvl.supabase.co'

const here = dirname(fileURLToPath(import.meta.url))
const distAssets = resolve(here, '..', 'dist', 'assets')
const clientRoot = resolve(here, '..')
const publicDir = resolve(clientRoot, 'public')

let porcelain
try {
  porcelain = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', publicDir], {
    cwd: clientRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
} catch {
  console.error(
    '[assert-prod-bundle] FAIL: could not run `git status` for client/public, so untracked files ' +
      'cannot be ruled out. Package from a git checkout.',
  )
  process.exit(1)
}
const untracked = porcelain
  .split('\n')
  .filter((line) => line.startsWith('?? '))
  .map((line) => line.slice(3).trim())
if (untracked.length > 0) {
  console.error(
    `[assert-prod-bundle] FAIL: ${untracked.length} untracked file(s) in client/public would ship inside the native binary:\n` +
      untracked.map((f) => `  - ${f}`).join('\n') +
      '\n  Move them out of client/public (or commit them if they are meant to ship) and rerun.',
  )
  process.exit(1)
}
console.log('[assert-prod-bundle] OK: no untracked files in client/public.')

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
