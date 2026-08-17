/**
 * Prerender the marketing landing (runs as npm postbuild).
 *
 * WHY: the landing was a CSR SPA page — first paint waited for the full JS
 * boot (Lighthouse prod mobile: LCP 6.1s, later 4.1s, with the LCP element
 * being the cookie banner). A 2026 marketing page is HTML-first.
 *
 * WHAT: renders the REAL built Landing in headless Chromium against dist/,
 * captures the HTML, and overwrites dist/index.html with it. app.html (a
 * prebuild copy, built as a second Vite input) remains the pure SPA shell:
 * every non-root route (vercel.json rewrite), the service-worker
 * navigateFallback, and the installed-PWA start_url point there — so deep
 * links, the PWA, and logged-in users never see a landing flash.
 *
 * Native note: Capacitor's entry stays index.html, so the snapshot includes
 * an inline gate that hides web-only store badges before hydration when
 * window.Capacitor reports native (the bridge script is injected by the
 * native webview ahead of ours).
 *
 * FAILURE POLICY: this script must NEVER fail the build. Any error keeps
 * the untouched SPA shell as index.html — exactly yesterday's behaviour —
 * and prints a loud warning instead.
 */
// Browsers install INSIDE node_modules so Vercel's build cache keeps them
// between deploys (a bare ~/.cache install would re-download ~130MB every
// build — or fail entirely on locked-down runners). Must be set before
// playwright is imported.
process.env.PLAYWRIGHT_BROWSERS_PATH = '0'

import { createServer } from 'node:http'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json',
}

async function serveDist() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      let file = path.join(DIST, urlPath)
      try {
        const st = await stat(file)
        if (st.isDirectory()) file = path.join(file, 'index.html')
        await stat(file)
      } catch {
        file = path.join(DIST, 'index.html') // SPA fallback (still the shell here)
      }
      const body = await readFile(file)
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404); res.end()
    }
  })
  await new Promise((resolve) => server.listen(0, resolve))
  return { server, port: server.address().port }
}

async function launchChromium() {
  // Path 1: full playwright (dev machines, GitHub CI — proven there).
  try {
    const { chromium } = await import('playwright')
    try {
      return await chromium.launch()
    } catch {
      console.warn('[prerender] chromium launch failed, installing…')
      execSync('npx playwright install chromium', { stdio: 'inherit', timeout: 300_000 })
      return await chromium.launch()
    }
  } catch (pwErr) {
    console.warn('[prerender] playwright path failed:', String(pwErr).slice(0, 140))
  }
  // Path 2: @sparticuz/chromium — a lambda-grade chromium that SHIPS ITS
  // OWN system libraries, built exactly for build containers (Vercel)
  // where `playwright install` binaries can't run.
  const sparticuz = (await import('@sparticuz/chromium')).default
  const { chromium: pwCore } = await import('playwright-core')
  return await pwCore.launch({
    executablePath: await sparticuz.executablePath(),
    args: sparticuz.args,
  })
}

function postProcess(html, shellHtml) {
  // HEAD comes from the SHELL, not the runtime DOM: at snapshot time the
  // Vite runtime has injected modulepreload links for every chunk the
  // booted app touched — measured on prod: charts (109KB, admin-only) plus
  // ~150KB of lazy-chunk preloads, all fetched at High priority against
  // the render-blocking CSS on every landing view. The shell's head is the
  // curated resource list (entry, filtered preloads, css); the snapshot
  // contributes ONLY its painted <body>.
  const shellHead = shellHtml.match(/<head>[\s\S]*?<\/head>/)
  const snapBody = html.match(/<body[\s\S]*<\/body>/)
  let out = html
  if (shellHead && snapBody) {
    const htmlOpen = html.match(/<html[^>]*>/)?.[0] ?? '<html lang="en">'
    out = `${htmlOpen}${shellHead[0]}${snapBody[0]}</html>`
  }

  // Reveal-on-scroll leaves below-fold sections at opacity:0 in the
  // snapshot. Static HTML must be fully visible (crawlers, pre-JS reads);
  // React re-mounts on boot and owns styles from there.
  out = out.replaceAll(/opacity:\s*0;?\s*/g, 'opacity: 1; ')
  out = out.replaceAll(/transform:\s*translateY\([^)]*\);?\s*/g, '')

  // Head-start gates:
  //  - __PRERENDERED_LANDING__ tells the client this DOM already painted, so
  //    entrance animations start visible instead of re-fading content the
  //    visitor has been reading for seconds.
  //  - the Capacitor check hides web-only store badges before hydration in
  //    the native webview (its bridge script runs before ours).
  const gate =
    '<script>window.__PRERENDERED_LANDING__=true;' +
    'try{if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){' +
    "document.documentElement.classList.add('is-native')}}catch(e){}</script>"
  out = out.replace('<head>', '<head>' + gate)

  if (!out.startsWith('<!DOCTYPE') && !out.startsWith('<!doctype')) {
    out = '<!doctype html>\n' + out
  }
  return out
}

async function main() {
  const shell = await readFile(path.join(DIST, 'index.html'), 'utf8')
  // Idempotency: a second run against an already-prerendered dist would
  // snapshot the snapshot and overwrite app.html with landing content.
  if (shell.includes('__PRERENDERED_LANDING__')) {
    console.log('[prerender] dist/index.html is already prerendered — skipping (rebuild to refresh)')
    return
  }
  // The SPA shell survives as app.html: the vercel.json rewrite, the SW
  // navigateFallback and the PWA start_url all point non-root navigation
  // here. Byte-copy of the BUILT shell — same hashed assets, no second
  // Vite input (which changes the output shape entirely).
  await writeFile(path.join(DIST, 'app.html'), shell)
  const { server, port } = await serveDist()
  const browser = await launchChromium()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    // Suppress overlays that must not be baked into static HTML.
    await page.addInitScript(() => { window.__PRERENDER__ = true })
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle', timeout: 45_000 })
    await page.waitForSelector('h1', { timeout: 15_000 })
    await page.waitForTimeout(1800)

    const html = await page.evaluate(() => document.documentElement.outerHTML)

    // Sanity gates — a broken snapshot must never replace the shell.
    // Web A hero (Figma 22:411, shipped 2026-08-15). Keep in sync with the
    // <h1> in src/pages/Landing.tsx — this gate exists so a broken render can
    // never silently replace the shell with an empty snapshot.
    if (!html.includes('The network for')) throw new Error('hero headline missing from snapshot')
    if (!/assets\/(index|main)-/.test(html)) throw new Error('entry script missing from snapshot')

    const processed = postProcess(html, shell)
    await writeFile(path.join(DIST, 'index.html'), processed)
    const grew = Math.round((processed.length - shell.length) / 1024)
    console.log(`[prerender] dist/index.html is now the prerendered landing (+${grew}KB over shell)`)
  } finally {
    await browser.close().catch(() => {})
    server.close()
  }
}

main().catch(async (err) => {
  // Even on failure the rewrite target must exist: app.html = the shell.
  try {
    const shell = await readFile(path.join(DIST, 'index.html'), 'utf8')
    await writeFile(path.join(DIST, 'app.html'), shell)
  } catch { /* dist missing entirely — nothing to do */ }
  console.warn('────────────────────────────────────────────────────────')
  console.warn('[prerender] FAILED — keeping the plain SPA shell for /.')
  console.warn('[prerender]', String(err).slice(0, 300))
  console.warn('────────────────────────────────────────────────────────')
  process.exit(0) // never fail the build
})
