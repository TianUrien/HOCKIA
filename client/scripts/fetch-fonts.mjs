#!/usr/bin/env node
// Downloads the licensed Satoshi WOFF2 files into public/fonts before a build.
//
// Satoshi's licence (ITF FFL 2.0) allows self-hosting but forbids putting the
// files in a public repository, so they live in the private repo
// TianUrien/hockia-private-assets and are gitignored here.
//
//   token : HOCKIA_ASSETS_TOKEN (fine-grained, read-only "Contents" on that repo)
//   output: public/fonts/Satoshi-{Bold,Medium,Black}.woff2
//
// Files already present are kept (local dev, native builds). Without the token
// a preview or CI build warns and the titles fall back to --font-sans; a
// Vercel production build fails instead of shipping without the brand font.
//
// Usage: node scripts/fetch-fonts.mjs  (runs as npm "prebuild")

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'TianUrien/hockia-private-assets'
const FILES = ['Satoshi-Bold.woff2', 'Satoshi-Medium.woff2', 'Satoshi-Black.woff2']
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts')
const token = process.env.HOCKIA_ASSETS_TOKEN
const production = process.env.VERCEL_ENV === 'production'

const missing = FILES.filter((f) => !existsSync(join(dir, f)))
if (missing.length === 0) process.exit(0)

if (!token) {
  const msg = `[fetch-fonts] HOCKIA_ASSETS_TOKEN is not set; missing ${missing.join(', ')}.`
  if (production) {
    console.error(`${msg} Production builds need the brand font.`)
    process.exit(1)
  }
  console.warn(`${msg} Titles fall back to the body font.`)
  process.exit(0)
}

mkdirSync(dir, { recursive: true })
for (const file of missing) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/fonts/${file}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json' },
  })
  if (!res.ok) {
    console.error(`[fetch-fonts] ${file}: HTTP ${res.status}`)
    process.exit(1)
  }
  writeFileSync(join(dir, file), Buffer.from(await res.arrayBuffer()))
  console.log(`[fetch-fonts] ${file}`)
}
