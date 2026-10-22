#!/usr/bin/env node
/**
 * Design-audit capture (2026-10-21): for each role, sign in on staging and
 * screenshot the main screens. Read-only: nothing is submitted, every sheet
 * is closed.
 *
 *   node audit.mjs [--device iphone-max,desktop-chrome] [--roles player,club] [--out <flat dir>]
 *
 * Credentials come from client/.env (E2E_*; staging test accounts, never
 * printed). Screens per role: home, community grid, member preview (vertical
 * deck + details panel on phones, classic deck on desktop), opportunities,
 * role page, applicants (recruiters only), own profile, one public profile,
 * inbox, messages, Hockia AI sheet. Web devices also capture offline error
 * states (Community, role page). Shots land in
 * report/audit-<stamp>/<device>/<role>--<nn>-<screen>.png and, with --out,
 * are copied flat as <device>--<role>--<nn>-<screen>.png.
 */
import fs from 'node:fs'
import path from 'node:path'
import { LAB_DIR, CLIENT_DIR, WEB_BASE, loadDevices, parseEnvFile, IOS_APP, ANDROID_APK } from './lib/config.mjs'
import { startAppium, openSession } from './lib/appium.mjs'
import { openWeb } from './lib/web.mjs'

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ENV = parseEnvFile(path.join(CLIENT_DIR, '.env'))
if (!/ivjkdaylalhsteyyclvl/.test(ENV.VITE_SUPABASE_URL || '')) throw new Error('client/.env does not point at staging; refusing to run')
const FIX = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'fixtures.json'), 'utf8')).staging

// Staging fixtures (test rows only).
const CLUB_APPLICANTS_ROLE = FIX.speedRoleId // "[QA] Club speed", two pending applications
const COACH_APPLICANTS_ROLE = 'a7b2dc93-4c00-4fbf-b76a-169b77fe7c70' // E2E Test Coach's open role with applications
const ROLE_PAGE = FIX.roleIds[0]
const ROLE_PAGE_ALT = FIX.roleIds[1] ?? FIX.roleIds[0]

const ROLES = [
  { id: 'player', env: 'E2E_PLAYER', publicProfile: '/clubs/e2e-test-fc' },
  { id: 'coach', env: 'E2E_COACH_PLAIN', publicProfile: '/members/e2e-test-player' },
  { id: 'recruiting-coach', env: 'E2E_COACH', publicProfile: '/members/e2e-test-player', applicants: COACH_APPLICANTS_ROLE },
  { id: 'club', env: 'E2E_CLUB', publicProfile: '/members/e2e-test-player', applicants: CLUB_APPLICANTS_ROLE },
  { id: 'brand', env: 'E2E_BRAND', publicProfile: '/members/e2e-test-player' },
  { id: 'umpire', env: 'E2E_UMPIRE', publicProfile: '/members/e2e-test-player' },
]

const wantedRoles = new Set(arg('roles', ROLES.map((r) => r.id).join(',')).split(','))
const devices = loadDevices(arg('device', 'iphone-max,desktop-chrome'))
const flatOut = arg('out', null)
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = path.join(LAB_DIR, 'report', `audit-${stamp}`)
fs.mkdirSync(outDir, { recursive: true })
if (flatOut) fs.mkdirSync(flatOut, { recursive: true })
const log = (m) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`; console.log(line); fs.appendFileSync(path.join(outDir, 'run.log'), line + '\n') }

const AUTH_KEY = 'hockia-auth'
async function go(lab, route) {
  // Web: staging keeps sockets open (realtime, captcha), so "networkidle" never comes.
  if (lab.page) { await lab.page.goto(WEB_BASE + route, { waitUntil: 'domcontentloaded', timeout: 45000 }); await sleep(1500); return }
  try { await lab.go(route) } catch (err) { if (!/navigation to .* ended/.test(err.message)) throw err }
}
async function signOut(lab) {
  try { await lab.eval((k) => { localStorage.removeItem(k); sessionStorage.clear() }, AUTH_KEY) } catch { /* no page yet */ }
}
async function signIn(lab, email, password) {
  await go(lab, '/signin'); await sleep(1500)
  const who = await lab.eval((k) => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.user?.email ?? null } catch { return null } }, AUTH_KEY)
  if (who && who.toLowerCase() === email.toLowerCase() && !(await lab.url()).startsWith('/signin')) return
  if (who) { await signOut(lab); await go(lab, '/signin'); await sleep(1500) }
  const hasForm = await lab.eval(() => !!document.querySelector('input[type="email"]'))
  if (!hasForm) await lab.eval(() => { const b = [...document.querySelectorAll('a, button')].find((x) => /^log in$/i.test(x.textContent?.trim() || '')); b?.click() })
  await lab.waitFor('input[type="email"]', 20000)
  await lab.type('input[type="email"]', email)
  await lab.type('input[type="password"]', password)
  await lab.tap('button[type="submit"]')
  for (let i = 0; i < 50; i++) { await sleep(500); let u = '/signin'; try { u = await lab.url() } catch { /* changing */ } if (!u.startsWith('/signin')) break }
  if ((await lab.url()).startsWith('/signin')) throw new Error('still on /signin after submitting')
  // Onboarding nudges and tips stay out of the screenshots.
  await lab.eval(() => { try { localStorage.setItem('hockia-ai-tip-seen', '1'); localStorage.setItem('hockia.community.vdeckHintSeen', '1') } catch { /* private */ } })
}

/** Settle: wait for skeletons and spinners to go (max ~8 s), then a beat for images. */
async function settle(lab, ms = 1200) {
  for (let i = 0; i < 16; i++) {
    const busy = await lab.eval(() => !!document.querySelector('.animate-pulse, .animate-spin, [aria-busy="true"]'))
    if (!busy) break
    await sleep(500)
  }
  await sleep(ms)
}

const results = []
let appium = null
for (const d of devices) {
  if (d.platform === 'ios' && !fs.existsSync(IOS_APP)) throw new Error('iOS app missing; run: npm run build')
  if (d.platform === 'android' && !fs.existsSync(ANDROID_APK)) throw new Error('Android APK missing; run: npm run build')
}
if (devices.some((d) => d.platform !== 'web')) appium = await startAppium(path.join(outDir, 'appium.log'))

for (const device of devices) {
  const devDir = path.join(outDir, device.id); fs.mkdirSync(devDir, { recursive: true })
  let lab
  try { lab = device.platform === 'web' ? await openWeb(device) : await openSession(device) } catch (e) { log(`${device.id}: SESSION FAILED ${e.message.slice(0, 200)}`); results.push({ device: device.id, role: '-', screen: 'session', ok: false, err: e.message.slice(0, 200) }); continue }
  const phone = device.kind === 'phone'
  for (const role of ROLES.filter((r) => wantedRoles.has(r.id))) {
    const email = ENV[`${role.env}_EMAIL`], password = ENV[`${role.env}_PASSWORD`]
    if (!email || !password) { log(`${device.id}/${role.id}: no credentials (${role.env}_*)`); continue }
    let n = 0
    const shot = async (screen) => {
      n += 1
      const name = `${role.id}--${String(n).padStart(2, '0')}-${screen}.png`
      const file = path.join(devDir, name)
      try { await lab.shot(file); if (flatOut) fs.copyFileSync(file, path.join(flatOut, `${device.id}--${name}`)) } catch (e) { log(`shot failed ${name}: ${e.message.slice(0, 80)}`) }
    }
    const step = async (screen, fn) => {
      try { await fn(); results.push({ device: device.id, role: role.id, screen, ok: true }) } catch (e) {
        results.push({ device: device.id, role: role.id, screen, ok: false, err: e.message.slice(0, 200) })
        log(`${device.id}/${role.id}: FAIL ${screen}: ${e.message.slice(0, 160)}`)
        await shot(`${screen}-FAILED`)
      }
    }
    log(`${device.id}/${role.id}: signing in`)
    try { await signOut(lab); await signIn(lab, email, password) } catch (e) { log(`${device.id}/${role.id}: SIGN-IN FAILED ${e.message.slice(0, 160)}`); results.push({ device: device.id, role: role.id, screen: 'sign-in', ok: false, err: e.message }); await shot('signin-FAILED'); continue }

    await step('home', async () => { await go(lab, '/home'); await lab.waitFor('main', 20000); await settle(lab, 2000); await shot('home') })
    await step('community-grid', async () => { await go(lab, '/community'); await lab.waitFor('[data-testid="member-tile"], main', 20000); await settle(lab, 2000); await shot('community-grid') })
    await step('member-preview', async () => {
      const opened = await lab.eval(() => { const tiles = [...document.querySelectorAll('[data-testid="member-tile"]')]; const t = tiles.find((x) => x.querySelector('img')) || tiles[0]; if (!t) return false; t.scrollIntoView({ block: 'center' }); t.click(); return true })
      if (!opened) throw new Error('no member tile to open')
      await lab.waitFor('[data-testid="member-preview"], [data-testid="member-vdeck-page"], [data-testid="member-deck-card"], [role="dialog"]', 15000)
      await settle(lab, 1800); await shot(phone ? 'deck' : 'member-preview')
      const more = await lab.eval(() => { const b = document.querySelector('[data-testid="member-vdeck-more"]'); if (!b) return false; b.click(); return true })
      if (more) { await lab.waitFor('[data-testid="member-vdeck-details"]', 8000); await sleep(1200); await shot('deck-details') }
      await lab.eval(() => { document.querySelector('[data-testid="member-preview-close"]')?.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
      await sleep(800)
    })
    await step('opportunities', async () => { await go(lab, '/opportunities'); await lab.waitFor('main', 20000); await settle(lab, 2000); await shot('opportunities') })
    await step('role-page', async () => { await go(lab, `/opportunities/${ROLE_PAGE}`); await lab.waitFor('h1', 20000); await settle(lab, 1500); await shot('role-page') })
    if (role.applicants) {
      await step('applicants', async () => { await go(lab, `/dashboard/opportunities/${role.applicants}/applicants`); await lab.waitFor('main, h1', 20000); await settle(lab, 2000); await shot('applicants') })
    }
    await step('profile-own', async () => { await go(lab, '/dashboard/profile'); await lab.waitFor('main, h1', 20000); await settle(lab, 2000); await shot('profile-own') })
    await step('profile-public', async () => { await go(lab, role.publicProfile); await lab.waitFor('main, h1', 20000); await settle(lab, 2000); await shot('profile-public') })
    await step('inbox', async () => { await go(lab, '/inbox'); await lab.waitFor('main', 20000); await settle(lab, 1500); await shot('inbox') })
    await step('messages', async () => { await go(lab, '/messages'); await lab.waitFor('main', 20000); await settle(lab, 1500); await shot('messages') })
    await step('hockia-ai', async () => {
      let found = false
      for (const route of ['/opportunities', '/home', '/community']) {
        await go(lab, route)
        try { await lab.waitFor('[data-testid="hockia-ai-button"]', 10000); found = true; break } catch { /* not on this screen */ }
      }
      if (!found) throw new Error('no Hockia AI button on Opportunities, Home or Community')
      await lab.eval(() => document.querySelector('[data-testid="hockia-ai-button"]')?.click())
      await lab.waitFor('[data-testid="hockia-ai-sheet"]', 15000); await sleep(1500); await shot('hockia-ai-sheet')
      await lab.eval(() => document.querySelector('[data-testid="hockia-ai-close"]')?.click()); await sleep(600)
    })
    // Error states: only where the network can be cut cleanly (Playwright).
    if (device.platform === 'web') {
      await step('offline-states', async () => {
        await go(lab, '/home'); await settle(lab, 800)
        await lab.page.context().setOffline(true)
        try {
          const nav = async (route) => { await lab.page.evaluate((r) => { window.history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')) }, route); await sleep(6000) }
          await nav(`/opportunities/${ROLE_PAGE_ALT}`); await shot('offline-role-page')
          await nav('/community/clubs'); await shot('offline-community')
        } finally { await lab.page.context().setOffline(false) }
      })
    }
    log(`${device.id}/${role.id}: done (${n} shots)`)
  }
  try { await lab.close() } catch { /* gone */ }
}
if (appium) appium.kill()
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ stamp, results }, null, 2))
const failed = results.filter((r) => !r.ok)
log(`finished: ${results.length - failed.length} ok, ${failed.length} failed. Output ${outDir}${flatOut ? ` and ${flatOut}` : ''}`)
