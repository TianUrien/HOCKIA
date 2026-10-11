#!/usr/bin/env node
/**
 * Crest colour backfill for club_crest_colors (Community club cards).
 *
 * Computes each crest's colour with the SAME code the app uses
 * (src/lib/crestColor.ts), in a real browser canvas, and prints SQL to apply.
 * Nothing is written by this script.
 *
 *   1. Export the clubs:  SELECT id, avatar_url FROM profiles
 *        WHERE role = 'club' AND avatar_url IS NOT NULL AND avatar_url <> '';
 *      → save as JSON [{ "id": "...", "avatar_url": "..." }]
 *   2. Run the dev server (npx vite --port 5201) so the module can be imported.
 *   3. node scripts/backfill-crest-colors.mjs clubs.json [http://localhost:5201] > backfill.sql
 *   4. Review, then run backfill.sql on the target project. It only touches
 *      club_crest_colors (no profiles UPDATE, so no profiles triggers fire).
 */
import fs from 'node:fs'
import { chromium } from 'playwright'

const [, , file, base = 'http://localhost:5201'] = process.argv
if (!file) {
  console.error('usage: node scripts/backfill-crest-colors.mjs clubs.json [devServerBase]')
  process.exit(1)
}
const clubs = JSON.parse(fs.readFileSync(file, 'utf8'))
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(base, { waitUntil: 'domcontentloaded' })
const results = await page.evaluate(async (list) => {
  const { extractCrestColor } = await import('/src/lib/crestColor.ts')
  const out = []
  for (const c of list) out.push({ id: c.id, url: c.avatar_url, color: await extractCrestColor(c.avatar_url) })
  return out
}, clubs)
await browser.close()

const esc = (s) => s.replace(/'/g, "''")
const rows = results.filter((r) => r.color)
console.log(`-- club_crest_colors backfill: ${rows.length} of ${results.length} crests have a usable colour.`)
for (const r of results.filter((x) => !x.color)) console.log(`-- no colour (keeps brand purple): ${r.id}`)
if (rows.length > 0) {
  console.log('INSERT INTO public.club_crest_colors (profile_id, crest_url, color) VALUES')
  console.log(rows.map((r) => `  ('${r.id}', '${esc(r.url)}', '${r.color}')`).join(',\n'))
  console.log('ON CONFLICT (profile_id) DO UPDATE SET crest_url = EXCLUDED.crest_url, color = EXCLUDED.color, updated_at = now();')
}
