/**
 * The core journeys, written once against the lab API (lib/appium.mjs and
 * lib/web.mjs). Each scenario is `async (lab, ctx) => void`; it throws to
 * fail and calls ctx.shot(name) to keep a screenshot. ctx.writes is false
 * by default: scenarios open the apply sheet and type a message but never
 * submit, so a run leaves staging as it found it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { qaCredentials, clubCredentials, brandCredentials, LAB_DIR } from '../lib/config.mjs'

const FIXTURES = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'fixtures.json'), 'utf8')).staging

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Did anything scroll? Phones scroll the document; the desktop-width layout
 * (tablets) scrolls an inner container. Measure both: window.scrollY plus
 * the scrollTop of every scrollable element, before and after the swipe.
 */
const SCROLL_STATE = () => {
  // Only visible scroll areas of a real size count: a hidden or tiny inner
  // scroller made a one-screen profile look "tall" (lab 2026-10-18).
  const els = [...document.querySelectorAll('*')].filter((el) => {
    const s = getComputedStyle(el)
    if (!/(auto|scroll)/.test(s.overflowY) || el.scrollHeight <= el.clientHeight + 40) return false
    const r = el.getBoundingClientRect()
    return s.visibility !== 'hidden' && r.width > 0 && r.height > 150 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
  })
  return {
    y: window.scrollY,
    inner: els.reduce((n, el) => n + el.scrollTop, 0),
    tall: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 40 || els.length > 0,
    locked: document.body.getAttribute('data-chat-scroll-lock'),
    pos: getComputedStyle(document.body).position,
    scrollers: els.length,
  }
}

async function assertScrolled(lab, ctx, label) {
  const before = await lab.eval(SCROLL_STATE)
  let after = before
  // Two attempts: a swipe can land while the page is still painting (loaded
  // simulators drop the first touch); a frozen page ignores both.
  for (let attempt = 0; attempt < 2; attempt++) {
    await lab.swipeUp(0.5)
    after = await lab.eval(SCROLL_STATE)
    if (after.y > before.y || after.inner > before.inner || !after.tall) break
    await sleep(1200)
  }
  await ctx.shot(`${label}-after-swipe`)
  const moved = after.y > before.y || after.inner > before.inner
  if (after.tall && !moved) throw new Error(`${label}: swipe did not scroll (scrollY ${before.y} → ${after.y}, inner ${before.inner} → ${after.inner}, ${after.scrollers} scrollers; body ${after.pos}, lock=${after.locked})`)
  return after
}

/**
 * An inner scroller (chat thread, deck) must move on a thumb swipe. A thread
 * opens at its bottom, so the swipe goes DOWN (towards older messages).
 */
async function assertInnerScrolled(lab, ctx, selector, label) {
  const before = await lab.eval((s) => document.querySelector(s)?.scrollTop ?? null, selector)
  let after = null
  for (let attempt = 0; attempt < 2; attempt++) {
    await lab.swipeDown(0.4)
    after = await lab.eval((s) => { const el = document.querySelector(s); return el ? { top: el.scrollTop, tall: el.scrollHeight > el.clientHeight + 40 } : null }, selector)
    if (!after || !after.tall || after.top !== before) break
    await sleep(1200)
  }
  await ctx.shot(`${label}-after-swipe`)
  if (!after) throw new Error(`${label}: scroller ${selector} not found`)
  if (after.tall && after.top === before) throw new Error(`${label}: swipe did not move ${selector} (scrollTop stayed ${before})`)
}

const AUTH_KEY = 'hockia-auth'

/** Email of the account whose session the app has persisted, if any. */
async function storedEmail(lab) {
  return lab.eval((k) => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.user?.email ?? null } catch { return null } }, AUTH_KEY)
}

/** Drop the persisted session and reload on the sign-in route. The app may
 *  bounce to its welcome screen ("/") on native; signInAs handles both. */
async function signOut(lab) {
  await lab.eval((k) => { localStorage.removeItem(k) }, AUTH_KEY)
  try { await lab.go('/signin') } catch (err) { if (!/navigation to \/signin ended/.test(err.message)) throw err }
  await sleep(1000)
}

/** Sign in as the given account; a session left by a previous run is kept
 *  when it belongs to the same account and replaced otherwise. */
async function signInAs(lab, ctx, { email, password }, label) {
  try { await lab.go('/signin') } catch (err) { if (!/navigation to \/signin ended/.test(err.message)) throw err }
  await sleep(1500)
  // App data survives between runs when the same build is already installed:
  // an already signed-in account lands on /home. That is fine for the same account.
  if (!(await lab.url()).startsWith('/signin')) {
    const who = await storedEmail(lab)
    if (who && who.toLowerCase() === email.toLowerCase()) { ctx.note(`already signed in as the ${label} account from a previous run`); await ctx.shot('already-signed-in'); return }
    ctx.note('a different account was signed in; replaced it')
    await signOut(lab)
    try { await lab.go('/signin') } catch (err) { if (!/navigation to \/signin ended/.test(err.message)) throw err }
    await sleep(1500)
  }
  // The native app opens on its welcome screen; "I already have an account"
  // ("Ya tengo una cuenta") leads to the form. "Log in" was its earlier label.
  const hasForm = await lab.eval(() => !!document.querySelector('input[type="email"]'))
  if (!hasForm) {
    await ctx.shot('welcome')
    await lab.eval(() => { const b = [...document.querySelectorAll('a, button')].find((x) => /^(i already have an account|ya tengo (una )?cuenta|log in|iniciar sesi[oó]n)$/i.test(x.textContent?.trim() || '')); b?.click() })
  }
  await lab.waitFor('input[type="email"]')
  await ctx.shot('signin-form')
  await lab.type('input[type="email"]', email)
  await lab.type('input[type="password"]', password)
  await lab.tap('button[type="submit"]')
  for (let i = 0; i < 40; i++) { await sleep(500); let u = '/signin'; try { u = await lab.url() } catch { /* window changing */ } if (!u.startsWith('/signin')) break }
  const url = await lab.url()
  await ctx.shot('after-signin')
  if (url.startsWith('/signin')) throw new Error('still on /signin after submitting')
  const overflow = await lab.eval(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  if (overflow) throw new Error('horizontal overflow after sign-in')
}

/** Publisher screens are phone-only (max-width 1023). Desktop browsers run
 *  them at a phone viewport; tablets report false and the journey is skipped. */
async function phoneWidth(lab, ctx) {
  if (lab.device.platform === 'web') { await lab.page.setViewportSize({ width: 390, height: 844 }); ctx.note('web viewport 390×844: publisher screens are phone-only'); return true }
  return lab.eval(() => window.innerWidth < 1024)
}
async function restoreWidth(lab) { if (lab.device.platform === 'web' && lab.device.viewport) await lab.page.setViewportSize(lab.device.viewport) }

/** Layout facts inside a root: sideways overflow, tap targets under 44 px, controls past the screen edge. */
async function layoutFacts(lab, scope) {
  return lab.eval((sel) => {
    const root = document.querySelector(sel) ?? document.body
    const vw = window.innerWidth
    const small = []; const off = []
    for (const el of root.querySelectorAll('button, a[href], input, textarea, [role="radio"], [role="tab"]')) {
      const b = el.getBoundingClientRect()
      if (!b.width || !b.height) continue
      const name = (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)
      // A control drawn smaller may carry a larger hit area (a ::before inset): a tap just outside each edge still lands on it (counted as the 2 px inset the app uses).
      const hit = (x, y) => { const at = document.elementFromPoint(x, y); return at === el || el.contains(at) }
      const cx = b.left + b.width / 2; const cy = b.top + b.height / 2
      const wide = hit(b.left - 1.5, cy) && hit(b.right + 1.5, cy) ? 4 : 0
      const tall = hit(cx, b.top - 1.5) && hit(cx, b.bottom + 1.5) ? 4 : 0
      if (b.height + tall < 43.5 || b.width + wide < 43.5) small.push(`${name} ${Math.round(b.width)}x${Math.round(b.height)}`)
      if (b.right > vw + 1 || b.left < -1) off.push(name)
    }
    return { overflowX: document.documentElement.scrollWidth - vw, small, off }
  }, scope)
}

export const scenarios = {
  async 'sign-in'(lab, ctx) {
    await signInAs(lab, ctx, qaCredentials(), 'player')
  },

  async 'home-feed'(lab, ctx) {
    await lab.go('/home')
    await lab.waitFor('main, [data-testid="home-feed"], article', 20000)
    await sleep(1500)
    await ctx.shot('home')
    await assertScrolled(lab, ctx, 'home')
    const overflow = await lab.eval(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    if (overflow) throw new Error('home: horizontal overflow')
  },

  async 'opportunities-role-apply'(lab, ctx) {
    await lab.go('/opportunities')
    // Role cards are tappable blocks (RoleCard on phones, OpportunityCard on desktop), not links.
    await lab.waitFor('[data-testid="role-card"], .cursor-pointer.rounded-2xl, main h2, main h3, h2, h3, a[href*="/opportunities/"]', 20000)
    await sleep(1000)
    await ctx.shot('opportunities-list')
    await assertScrolled(lab, ctx, 'opportunities-list')
    if (lab.device.platform === 'web') {
      // Desktop (D1/D2, 16 Oct 2026): a card opens the role as a PAGE, no preview dialog.
      const clicked = await lab.eval(() => { const c = document.querySelector('[data-testid="role-card-open"], [data-testid="featured-role"]'); if (!c) return false; c.click(); return true })
      if (!clicked) throw new Error('no role card on the desktop list')
      let url = ''
      for (let i = 0; i < 40; i++) { await sleep(500); url = await lab.url(); if (/\/opportunities\/[0-9a-f-]{36}/.test(url)) break }
      if (!/\/opportunities\/[0-9a-f-]{36}/.test(url)) throw new Error(`clicking a role card did not open a role page (url ${url})`)
      await lab.waitFor('[data-testid="role-detail-desktop"] h1', 20000)
      await sleep(800)
      await ctx.shot('role-page')
      const state = await assertScrolled(lab, ctx, 'role-page')
      if (!state.tall) ctx.note('the role page fits the desktop viewport; scroll not asserted')
      const sticky = await lab.eval(() => getComputedStyle(document.querySelector('[data-testid="role-detail-aside"]')).position)
      if (sticky !== 'sticky') throw new Error(`the cover column is ${sticky}, expected sticky`)
      const apply = await lab.eval(() => { const b = document.querySelector('[data-testid="role-apply"]'); if (!b) return false; b.click(); return true })
      if (apply) {
        await sleep(1200)
        await ctx.shot('apply-sheet')
        const sheet = await lab.eval(() => !!document.querySelector('[role="dialog"]'))
        if (!sheet) throw new Error('apply sheet did not open')
        await lab.eval(() => { const c = document.querySelector('[role="dialog"] button[aria-label*="lose" i], [role="dialog"] button[aria-label*="ancel" i]'); c?.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
      } else {
        ctx.note('no Apply button (already applied, own role, or closed) — sheet not tested')
      }
      return
    }
    // Open up to three roles until one is longer than the screen: a short
    // role page proves nothing about scrolling. The long QA role goes first.
    let tall = false
    for (let n = 0; n < 3 && !tall; n++) {
      if (n > 0) { await lab.go('/opportunities'); await lab.waitFor('[data-testid="role-card-open"], main h3', 20000); await sleep(800) }
      const tapped = await lab.eval((idx, longTitle) => {
        let cards = [...document.querySelectorAll('[data-testid="role-card-open"]')]
        const long = cards.find((c) => (c.textContent || '').includes(longTitle))
        if (long) cards = [long, ...cards.filter((c) => c !== long)]
        const links = [...document.querySelectorAll('a[href*="/opportunities/"]')].filter((a) => /\/opportunities\/[0-9a-f-]{36}/.test(a.getAttribute('href') || ''))
        const el = cards[idx] || links[idx] || [...document.querySelectorAll('main h3, main h2')][idx]
        if (!el) return false
        el.scrollIntoView({ block: 'center' }); el.click()
        return true
      }, n, FIXTURES.longRoleTitle)
      if (!tapped) { if (n === 0) throw new Error('no role card on /opportunities'); break }
      let url = ''
      for (let i = 0; i < 40; i++) { await sleep(500); url = await lab.url(); if (/\/opportunities\/[0-9a-f-]{36}/.test(url)) break }
      if (!/\/opportunities\/[0-9a-f-]{36}/.test(url)) throw new Error(`tapping a role card did not open a role page (url ${url})`)
      await lab.waitFor('h1', 20000)
      await sleep(800)
      await ctx.shot(`role-page-${n + 1}`)
      // The bug of 15 Oct: a thumb swipe must move the role page.
      const state = await assertScrolled(lab, ctx, `role-page-${n + 1}`)
      tall = state.tall
    }
    if (!tall) ctx.note('every role tried fits the screen; swipe scrolling could not be asserted on the role page')
    const apply = await lab.eval(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(apply|apply now)$/i.test(x.textContent?.trim() || '')); return b ? true : false })
    if (apply) {
      await lab.eval(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(apply|apply now)$/i.test(x.textContent?.trim() || '')); b?.click() })
      await sleep(1200)
      await ctx.shot('apply-sheet')
      const sheet = await lab.eval(() => !!document.querySelector('[role="dialog"], [data-testid*="apply"]'))
      if (!sheet) throw new Error('apply sheet did not open')
      // Close without submitting (Escape / close button).
      await lab.eval(() => { const c = document.querySelector('[role="dialog"] button[aria-label*="lose" i], [role="dialog"] button[aria-label*="ancel" i]'); c?.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    } else {
      ctx.note('no Apply button (already applied, own role, or closed) — sheet not tested')
    }
  },

  async 'inbox-thread'(lab, ctx) {
    await lab.go('/inbox')
    await lab.waitFor('[data-testid="conversation-row"], [data-testid="conversation-item"], main', 20000)
    await sleep(1200)
    await ctx.shot('inbox')
    // Rows are buttons (InboxMessages → navigate(/messages/:id)), not links.
    const tapped = await lab.eval(() => { const r = document.querySelector('[data-testid="conversation-row"], [data-testid="conversation-item"]'); if (!r) return false; r.click(); return true })
    if (!tapped) { ctx.note('no conversation in the QA inbox — thread not tested'); return }
    let url = ''
    for (let i = 0; i < 40; i++) { await sleep(500); url = await lab.url(); if (/\/messages\/[^/]+/.test(url)) break }
    if (!/\/messages\/[^/]+/.test(url)) throw new Error(`tapping a conversation row did not open a thread (url ${url})`)
    await lab.waitFor('.chat-scroll-container, [data-testid="chat-scroll"], textarea', 20000)
    await sleep(1200)
    await ctx.shot('thread')
    const scroller = await lab.eval(() => document.querySelector('.chat-scroll-container') ? '.chat-scroll-container' : null)
    if (scroller) {
      // Swipe DOWN (towards older messages) must move the thread.
      await assertInnerScrolled(lab, ctx, scroller, 'thread')
    }
    await lab.type('textarea', 'Device lab check — not sent')
    await ctx.shot('thread-typed')
    if (ctx.writes) { await lab.tap('button[type="submit"], button[aria-label*="end" i]'); await sleep(1500); await ctx.shot('thread-sent') }
    else await lab.eval(() => { const t = document.querySelector('textarea'); if (t) { t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })) } })
  },

  async 'community-profile'(lab, ctx) {
    await lab.go('/community')
    await lab.waitFor('[data-testid="member-tile"], a[href*="/members/"], a[href*="/players/"]', 20000)
    await sleep(1000)
    await ctx.shot('community')
    await assertScrolled(lab, ctx, 'community')
    // Phone grid: a tile opens the member preview sheet; "View full profile" opens the profile.
    const tileTapped = await lab.eval(() => { const t = document.querySelector('[data-testid="member-tile"]'); if (!t) return false; t.scrollIntoView({ block: 'center' }); t.click(); return true })
    if (tileTapped) {
      // Phone sheet carries a testid; the desktop-width preview says "See full profile".
      const FULL = () => document.querySelector('[data-testid="member-preview-full-profile"]') || [...document.querySelectorAll('a, button')].find((x) => /see full profile|view full profile/i.test(x.textContent?.trim() || ''))
      // Phone vertical deck (21 Oct 2026): the full-profile link lives in the
      // details panel, behind the "More" chevron.
      const deadline = Date.now() + 8000
      while (Date.now() < deadline && !(await lab.eval(() => document.querySelector('[data-testid="member-vdeck-more"], [data-testid="member-preview-full-profile"]')))) await sleep(300)
      const opened = await lab.eval(() => { const m = [...document.querySelectorAll('[data-testid="member-vdeck-more"]')].find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight }); if (!m) return false; m.click(); return true })
      if (opened) { await sleep(900); await ctx.shot('deck-details') }
      const t0 = Date.now()
      while (Date.now() - t0 < 15000 && !(await lab.eval(FULL))) await sleep(300)
      await sleep(600)
      await ctx.shot('member-preview')
      // The phone deck renders a sheet per card, so pick the VISIBLE one (inside the viewport).
      const ok = await lab.eval(() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight }
        const all = [...document.querySelectorAll('[data-testid="member-preview-full-profile"], a, button')].filter((x) => x.matches('[data-testid="member-preview-full-profile"]') || /see full profile|view full profile/i.test(x.textContent?.trim() || ''))
        const el = all.find(visible) || all[0]
        if (!el) return false
        el.click(); return true
      })
      if (!ok) throw new Error('member preview did not offer a full-profile link')
    } else {
      const href = await lab.eval(() => [...document.querySelectorAll('a[href*="/members/"], a[href*="/players/"]')].map((a) => a.getAttribute('href')).find(Boolean))
      if (!href) throw new Error('no member tile or link on /community')
      await lab.go(href)
    }
    let purl = ''
    for (let i = 0; i < 40; i++) { await sleep(500); purl = await lab.url(); if (/\/(members|players)\//.test(purl)) break }
    if (!/\/(members|players)\//.test(purl)) throw new Error(`profile did not open from the community (url ${purl})`)
    await lab.waitFor('h1, [data-testid="profile-header"]', 20000)
    await sleep(800)
    await ctx.shot('public-profile')
    await assertScrolled(lab, ctx, 'public-profile')
  },

  async 'profile-edit'(lab, ctx) {
    // The own profile lives at /dashboard/profile (the Profile tab); /profile is a 404.
    await lab.go('/dashboard/profile')
    await lab.waitFor('h1, [data-testid="profile-header"], main', 20000)
    await sleep(1500)
    await ctx.shot('own-profile')
    // A signed-in cold load of a protected route must not bounce to the welcome screen.
    const bounced = await lab.eval(() => ({ away: !window.location.pathname.startsWith('/dashboard') && /create account|log in/i.test(document.body.innerText || ''), hasSession: Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)) }))
    if (bounced.away && bounced.hasSession) throw new Error(`signed-in cold load of /dashboard/profile landed on ${await lab.url()} (welcome) although a session is stored — session not restored before the route guard`)
    if (bounced.away) throw new Error('not signed in (sign-in step failed earlier), so the profile could not be tested')
    await assertScrolled(lab, ctx, 'own-profile')
    const opened = await lab.eval(() => { const b = document.querySelector('[data-testid="profile-edit"]') || [...document.querySelectorAll('a, button')].find((x) => /edit profile|^edit$/i.test(x.textContent?.trim() || '') || /edit/i.test(x.getAttribute('aria-label') || '')); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true })
    await sleep(1200)
    await ctx.shot('profile-edit')
    if (!opened) ctx.note('no Edit control found on /profile')
  },

  // Hockia AI sheet (beta, 16 Oct 2026): the Opportunities mascot opens the
  // sheet over the page; it grows to full height and closes. No question is
  // sent, so no daily quota is used.
  // Opt-in (one Hockia AI profile read on staging): "Fill my profile for me"
  // from the chat, typed text only (the lab can't drive the OS file pickers),
  // review card checked, closed WITHOUT saving.
  async 'hockia-ai-profile-builder'(lab, ctx) {
    await lab.go('/opportunities')
    await lab.waitFor('[data-testid="hockia-ai-button"]', 20000)
    await sleep(800)
    await lab.eval(() => { localStorage.setItem('hockia-ai-tip-seen', '1'); document.querySelector('[data-testid="hockia-ai-button"]')?.click() })
    await lab.waitFor('[data-testid="hockia-ai-fill-profile"]', 15000)
    await sleep(800)
    await ctx.shot('chip')
    await lab.tap('[data-testid="hockia-ai-fill-profile"]')
    await lab.waitFor('[data-testid="profile-builder"]', 10000)
    await sleep(800)
    await ctx.shot('intro')
    await lab.type('[data-testid="builder-composer"]', 'I played for Banco Provincia in Buenos Aires from 2019 to 2022 in Metro A, then Club de Campo in Madrid since 2023.')
    await sleep(400)
    await lab.tap('[data-testid="builder-send"]')
    await lab.waitFor('[data-testid="builder-reading"], [data-testid="builder-review"], [data-testid="builder-nothing"], [data-testid="builder-error"]', 15000)
    await ctx.shot('reading')
    await lab.waitFor('[data-testid="builder-review"], [data-testid="builder-nothing"], [data-testid="builder-error"]', 90000)
    await sleep(1000)
    await ctx.shot('review')
    const r = await lab.eval(() => ({ err: document.querySelector('[data-testid="builder-error"]')?.textContent || null, rows: document.querySelectorAll('[data-testid="builder-career-row"]').length, nothing: !!document.querySelector('[data-testid="builder-nothing"]'), save: !!document.querySelector('[data-testid="builder-save-all"]') }))
    if (r.err) throw new Error(`builder error: ${r.err.slice(0, 120)}`)
    // The QA player may already have these clubs from an earlier run: "nothing new" is a valid answer.
    if (!r.nothing && (!r.rows || !r.save)) throw new Error(`review card incomplete: ${JSON.stringify(r)}`)
    ctx.note(r.nothing ? 'nothing new to add (clubs already on the profile)' : `${r.rows} career rows proposed; not saved`)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-close"]')?.click())
    await sleep(600)
  },

  // Opt-in (one question + one draft on staging): "Prepare my application"
  // from a role result. The draft card (or an honest already-applied / not
  // eligible answer) must show; nothing is SENT.
  async 'hockia-ai-apply'(lab, ctx) {
    await lab.go('/opportunities')
    await lab.waitFor('[data-testid="hockia-ai-button"]', 20000)
    await sleep(800)
    await lab.eval(() => { localStorage.setItem('hockia-ai-tip-seen', '1'); document.querySelector('[data-testid="hockia-ai-button"]')?.click() })
    await lab.waitFor('[data-testid="hockia-ai-composer"]', 15000)
    await lab.type('[data-testid="hockia-ai-composer"]', 'Show me all open roles')
    await lab.tap('[data-testid="hockia-ai-send"]')
    await lab.waitFor('[data-testid="ai-role-prepare"]', 60000)
    await sleep(1200)
    await ctx.shot('results')
    await lab.eval(() => document.querySelector('[data-testid="ai-role-prepare"]')?.click())
    await lab.waitFor('[data-testid="apply-draft-card"], [data-testid="apply-not-eligible"], [data-testid="apply-already"], [data-testid="apply-closed"], [data-testid="apply-error"]', 45000)
    await sleep(800)
    await ctx.shot('draft')
    const r = await lab.eval(() => ({ card: !!document.querySelector('[data-testid="apply-draft-card"]'), send: !!document.querySelector('[data-testid="apply-send"]'), already: !!document.querySelector('[data-testid="apply-already"]'), notEligible: !!document.querySelector('[data-testid="apply-not-eligible"]'), err: document.querySelector('[data-testid="apply-error"]')?.textContent || null }))
    if (r.err) throw new Error(`apply draft error: ${r.err}`)
    if (r.card && !r.send) throw new Error('draft card without Send application')
    if (!r.card && !r.already && !r.notEligible) throw new Error(`no draft: ${JSON.stringify(r)}`)
    ctx.note(r.card ? 'draft card shown; not sent' : r.already ? 'already applied (honest answer)' : 'not eligible (neutral callout)')
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-close"]')?.click())
    await sleep(600)
  },

  // Opt-in, no AI call: "Ask Hockia AI about this role" on the fixture role
  // opens the sheet with the role chip and its three suggestions.
  async 'hockia-ai-role'(lab, ctx) {
    await lab.go(`/opportunities/${FIXTURES.roleIds[1] ?? FIXTURES.roleIds[0]}`)
    await lab.waitFor('[data-testid="role-ask-ai"]', 20000)
    await sleep(800)
    await lab.eval(() => document.querySelector('[data-testid="role-ask-ai"]')?.scrollIntoView({ block: 'center' }))
    await ctx.shot('entry')
    await lab.tap('[data-testid="role-ask-ai"]')
    await lab.waitFor('[data-testid="hockia-ai-role-chip"]', 10000)
    await sleep(1000)
    await ctx.shot('sheet')
    const n = await lab.eval(() => document.querySelectorAll('[data-testid="hockia-ai-role-suggestion"]').length)
    if (n < 2) throw new Error(`role sheet shows ${n} suggestions`)
    ctx.note(`${n} role suggestions`)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-dim"]')?.click())
    await sleep(600)
  },

  async 'hockia-ai-sheet'(lab, ctx) {
    await lab.go('/opportunities')
    await lab.waitFor('[data-testid="hockia-ai-button"]', 20000)
    await sleep(800)
    await lab.eval(() => { localStorage.setItem('hockia-ai-tip-seen', '1'); document.querySelector('[data-testid="hockia-ai-button"]')?.click() })
    await lab.waitFor('[data-testid="hockia-ai-sheet"]', 15000)
    await sleep(1500)
    await ctx.shot('sheet-medium')
    const medium = await lab.eval(() => ({ detent: document.querySelector('[data-testid="hockia-ai-sheet"]')?.getAttribute('data-detent'), suggestions: document.querySelectorAll('[data-testid="hockia-ai-suggestion"], [data-testid="hockia-ai-option"]').length, beta: !!document.querySelector('[data-testid="hockia-ai-beta"]') }))
    if (medium.detent !== 'medium' || medium.suggestions < 1 || !medium.beta) throw new Error(`medium sheet wrong: ${JSON.stringify(medium)}`)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-grabber"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 100 })))
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-grabber"]')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 100 })))
    await sleep(1200)
    await ctx.shot('sheet-large')
    const large = await lab.eval(() => document.querySelector('[data-testid="hockia-ai-sheet"]')?.getAttribute('data-detent'))
    if (large !== 'large') throw new Error(`grabber tap did not grow the sheet (detent ${large})`)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-close"]')?.click())
    await sleep(800)
    if (await lab.eval(() => !!document.querySelector('[data-testid="hockia-ai-sheet"]'))) throw new Error('the sheet did not close')
  },

  // Opt-in (uses one Hockia AI question of the daily cap): ask a question in
  // the sheet and check the live steps stream in and an answer arrives — the
  // event stream must work inside WKWebView / Android WebView too.
  async 'hockia-ai-ask'(lab, ctx) {
    await lab.go('/opportunities')
    await lab.waitFor('[data-testid="hockia-ai-button"]', 20000)
    await lab.eval(() => { localStorage.setItem('hockia-ai-tip-seen', '1'); document.querySelector('[data-testid="hockia-ai-button"]')?.click() })
    await lab.waitFor('[data-testid="hockia-ai-suggestion"], [data-testid="hockia-ai-option"]', 15000)
    await sleep(800)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-suggestion"], [data-testid="hockia-ai-option"]')?.click())
    let sawSteps = 0
    for (let i = 0; i < 90; i++) {
      await sleep(300)
      const st = await lab.eval(() => ({ steps: document.querySelectorAll('[data-testid="hockia-ai-step"]').length, thinking: !!document.querySelector('[data-testid="hockia-ai-thinking"]') }))
      if (st.steps > sawSteps) { sawSteps = st.steps; if (sawSteps === 2) await ctx.shot('steps') }
      if (!st.thinking && i > 2) break
    }
    await sleep(2500)
    await ctx.shot('answer')
    const res = await lab.eval(() => ({ error: /trouble connecting|lost the signal/i.test(document.querySelector('[data-testid="hockia-ai-conversation"]')?.textContent || ''), chars: (document.querySelector('[data-testid="hockia-ai-conversation"]')?.textContent || '').length }))
    if (res.error) throw new Error('Hockia AI answered with the connection error')
    if (sawSteps < 1) throw new Error('no live step arrived before the answer (event stream not read?)')
    ctx.note(`${sawSteps} live steps, answer ${res.chars} chars`)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-close"]')?.click())
  },

  // Opt-in (uses one Hockia AI question): the answered chat is saved to
  // Your chats (handoff C2) under Today, reopens with its answer, and its
  // delete removes it. Leaves nothing behind.
  async 'hockia-ai-history'(lab, ctx) {
    await lab.go('/opportunities')
    await lab.waitFor('[data-testid="hockia-ai-button"]', 20000)
    await lab.eval(() => { localStorage.setItem('hockia-ai-tip-seen', '1'); document.querySelector('[data-testid="hockia-ai-button"]')?.click() })
    await lab.waitFor('[data-testid="hockia-ai-suggestion"], [data-testid="hockia-ai-option"]', 15000)
    await sleep(800)
    const asked = await lab.eval(() => { const b = document.querySelector('[data-testid="hockia-ai-suggestion"], [data-testid="hockia-ai-option"]'); const q = b?.querySelector('span:nth-child(2)')?.textContent || ''; b?.click(); return q })
    for (let i = 0; i < 100; i++) {
      await sleep(300)
      if (i > 3 && !(await lab.eval(() => !!document.querySelector('[data-testid="hockia-ai-thinking"]')))) break
    }
    await sleep(3000)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-more"]')?.click())
    await lab.waitFor('[data-testid="hockia-ai-chats"]', 8000)
    await sleep(500)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-chats"]')?.click())
    await lab.waitFor('[data-testid="hockia-ai-history-row"]', 15000)
    await sleep(800)
    await ctx.shot('chats')
    const first = await lab.eval(() => {
      const sec = document.querySelector('[data-testid="hockia-ai-history"] section')
      const row = sec?.querySelector('[data-testid="hockia-ai-history-row"]')
      return { group: sec?.getAttribute('aria-label'), title: row?.querySelector('span span')?.textContent || '', summary: row?.querySelectorAll('span span')[1]?.textContent || '' }
    })
    if (first.group !== 'Today') throw new Error(`newest chat is under "${first.group}", expected Today`)
    if (asked && first.title.slice(0, 20) !== asked.trim().slice(0, 20)) throw new Error(`top row "${first.title}" is not the question asked ("${asked}")`)
    // Reopen it: the conversation comes back with the answer.
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-history-open"]')?.click())
    await lab.waitFor('[data-testid="hockia-ai-conversation"]', 15000)
    await sleep(1200)
    await ctx.shot('reopened')
    const chars = await lab.eval(() => (document.querySelector('[data-testid="hockia-ai-conversation"]')?.textContent || '').length)
    if (chars < 20) throw new Error('the reopened chat is empty')
    // Back to the list and delete it.
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-more"]')?.click())
    await lab.waitFor('[data-testid="hockia-ai-chats"]', 8000)
    await sleep(500)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-chats"]')?.click())
    await lab.waitFor('[data-testid="hockia-ai-history-row"]', 15000)
    await sleep(800)
    const before = await lab.eval(() => document.querySelectorAll('[data-testid="hockia-ai-history-row"]').length)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-history-delete"]')?.click())
    await sleep(1500)
    await ctx.shot('deleted')
    const after = await lab.eval(() => document.querySelectorAll('[data-testid="hockia-ai-history-row"]').length)
    if (after !== before - 1) throw new Error(`delete left ${after} of ${before} rows`)
    ctx.note(`"${first.title}" · ${first.summary} → reopened (${chars} chars) → deleted`)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-history-close"]')?.click())
  },

  // Opt-in, no AI call and no writes: Hockia AI opens with the next-step
  // plan as a choice card (recommended first + Other), the bio step asks
  // what to lead with, and a vague question gets a choice card in the chat.
  async 'hockia-ai-next-steps'(lab, ctx) {
    await lab.go('/opportunities')
    await lab.waitFor('[data-testid="hockia-ai-button"]', 20000)
    await lab.eval(() => { localStorage.setItem('hockia-ai-tip-seen', '1'); document.querySelector('[data-testid="hockia-ai-button"]')?.click() })
    await lab.waitFor('[data-testid="ai-next-step"]', 15000)
    await sleep(1200)
    await ctx.shot('plan')
    const plan = await lab.eval(() => {
      const opts = [...document.querySelectorAll('[data-testid="ai-next-step-option"]')]
      return { n: opts.length, firstRecommended: opts[0]?.getAttribute('data-recommended') === 'true', recommended: opts.filter((o) => o.getAttribute('data-recommended') === 'true').length, other: !!document.querySelector('[data-testid="ai-next-step-other"]'), first: opts[0]?.querySelector('span span span')?.textContent || '' }
    })
    if (!plan.n || !plan.firstRecommended || plan.recommended !== 1 || !plan.other) throw new Error(`plan card wrong: ${JSON.stringify(plan)}`)
    // The bio step (if offered) asks first, before any AI call.
    const bio = await lab.eval(() => { const b = [...document.querySelectorAll('[data-testid="ai-next-step-option"]')].find((o) => /bio/i.test(o.textContent || '')); b?.click(); return !!b })
    if (bio) {
      await lab.waitFor('[data-testid="ai-bio-focus"]', 8000)
      await sleep(800)
      await ctx.shot('bio-focus')
      const n = await lab.eval(() => document.querySelectorAll('[data-testid="ai-bio-focus-option"]').length)
      if (n !== 3) throw new Error(`bio focus shows ${n} options`)
      await lab.eval(() => document.querySelector('[data-testid="hockia-ai-to-chat"]')?.click())
      await sleep(800)
    }
    // A vague question gets a choice card (no AI call: the clarifier answers).
    await lab.eval(() => { const t = document.querySelector('[data-testid="hockia-ai-composer"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Find people'); t.dispatchEvent(new Event('input', { bubbles: true })) })
    await sleep(300)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-send"]')?.click())
    await lab.waitFor('[data-testid="ai-clarify"]', 20000)
    await sleep(1200)
    await ctx.shot('clarify')
    const clar = await lab.eval(() => ({ first: document.querySelector('[data-testid="ai-clarify-option"]')?.getAttribute('data-recommended'), other: !!document.querySelector('[data-testid="ai-clarify-other"]') }))
    if (clar.first !== 'true' || !clar.other) throw new Error(`clarify card wrong: ${JSON.stringify(clar)}`)
    ctx.note(`plan: ${plan.n} steps, "${plan.first}" recommended${bio ? '; bio asks first' : ''}; chat question card OK`)
    await lab.eval(() => document.querySelector('[data-testid="hockia-ai-close"]')?.click())
  },

  // Home → role (17 Oct 2026): a Home role opens the v2 role page, and closing
  // it returns to Home at the same scroll position.
  async 'home-role-back'(lab, ctx) {
    await lab.go('/home')
    await lab.waitFor('[data-testid="home-roles-rail"] button', 25000)
    await sleep(1500)
    // Real thumb swipes (native gestures on phones, wheel on desktop), then measure.
    await lab.swipeUp(0.5)
    await lab.swipeUp(0.5)
    // Let momentum scrolling settle (iOS keeps gliding) before measuring.
    let before = -1
    for (let i = 0; i < 10; i++) { await sleep(500); const y = await lab.eval(() => Math.round(window.scrollY)); if (y === before) break; before = y }
    await ctx.shot('home-before')
    await lab.eval(() => document.querySelector('[data-testid="home-roles-rail"] button')?.click())
    let url = ''
    for (let i = 0; i < 40; i++) { await sleep(500); url = await lab.url(); if (/\/opportunities\/[0-9a-f-]{36}/.test(url)) break }
    if (!/\/opportunities\/[0-9a-f-]{36}/.test(url)) throw new Error(`the Home role did not open the role page (url ${url})`)
    await lab.waitFor('[data-testid="role-detail"], [data-testid="role-detail-desktop"]', 20000)
    await sleep(1000)
    await ctx.shot('role-from-home')
    await lab.eval(() => document.querySelector('[data-testid="role-close"]')?.click())
    for (let i = 0; i < 40; i++) { await sleep(500); if ((await lab.url()).startsWith('/home')) break }
    await sleep(2500)
    const after = await lab.eval(() => Math.round(window.scrollY))
    await ctx.shot('home-after-back')
    ctx.note(`scroll ${before} → ${after}`)
    if (before > 100 && Math.abs(after - before) > 60) throw new Error(`Home scroll not restored (${before} → ${after})`)
  },

  // ---- Publisher (club) journeys: `--scenario club` ----------------------

  async 'club-sign-in'(lab, ctx) {
    await signInAs(lab, ctx, clubCredentials(), 'club')
  },

  async 'club-roles'(lab, ctx) {
    if (!(await phoneWidth(lab, ctx))) { ctx.note('tablet width: the club roles screen is phone-only; skipped'); return }
    try {
      await lab.go('/opportunities')
      await lab.waitFor('[data-testid="club-opportunities-screen"], [data-testid="club-opportunities-first-run"]', 20000)
      await sleep(1500)
      await ctx.shot('club-roles')
      // Role cards show the position, not the title, so the fixture role is
      // recognised by its cover photo: at least one open card must carry one.
      const seen = await lab.eval(() => {
        const cards = [...document.querySelectorAll('[data-testid="club-role-card"]')]
        const photos = cards.filter((c) => { const i = c.querySelector('img[src*="role-covers"]'); return i && !(i.complete && i.naturalWidth === 0) })
        return { cards: cards.length, photos: photos.length }
      })
      if (!seen.cards) throw new Error('no role cards on the club roles screen')
      if (!seen.photos) throw new Error('no open role card shows a cover photo (fixture coverRoleId must be open and carry one)')
      ctx.note(`${seen.photos} of ${seen.cards} role cards show a cover photo`)
      const overflow = await lab.eval(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      if (overflow) throw new Error('club roles: horizontal overflow')
    } finally { await restoreWidth(lab) }
  },

  async 'club-post-role-cover'(lab, ctx) {
    if (!(await phoneWidth(lab, ctx))) { ctx.note('tablet width: Post a role is phone-only; skipped'); return }
    try {
      await lab.go('/dashboard/opportunities/new')
      await lab.waitFor('[data-testid="post-role-screen"]', 20000)
      await lab.waitFor('[data-testid="post-role-cover-add"]', 15000)
      await sleep(800)
      await ctx.shot('cover-section')
      const label = await lab.eval(() => document.querySelector('[data-testid="post-role-cover-add"]')?.textContent?.trim())
      if (!/add photo/i.test(label || '')) throw new Error(`cover button reads "${label}", expected Add photo`)
      const accept = await lab.eval(() => document.querySelector('[data-testid="post-role-cover-input"]')?.getAttribute('accept'))
      if (!accept || !/image/.test(accept)) throw new Error('cover file input missing or not image-only')
      if (lab.device.platform !== 'web') {
        // Phones: the button opens the OS photo picker, which the lab does not drive.
        ctx.note('phone: cover section and image-only picker input verified; native picker not driven')
        return
      }
      await lab.page.setInputFiles('[data-testid="post-role-cover-input"]', path.join(LAB_DIR, 'fixtures', 'lab-cover.png'))
      await lab.waitFor('[data-testid="post-role-cover-preview"] img[src*="role-covers"]', 30000)
      await sleep(1000)
      await ctx.shot('cover-uploaded')
      const after = await lab.eval(() => document.querySelector('[data-testid="post-role-cover-add"]')?.textContent?.trim())
      if (!/change/i.test(after || '')) throw new Error(`after the upload the button reads "${after}", expected Change`)
      await lab.tap('[data-testid="post-role-cover-remove"]')
      for (let i = 0; i < 30; i++) { await sleep(500); if (await lab.eval(() => !document.querySelector('[data-testid="post-role-cover-preview"] img[src*="role-covers"]'))) break }
      const back = await lab.eval(() => document.querySelector('[data-testid="post-role-cover-add"]')?.textContent?.trim())
      if (!/add photo/i.test(back || '')) throw new Error(`after Remove the button reads "${back}", expected Add photo`)
      await ctx.shot('cover-removed')
      // Leave without saving: Remove deleted the uploaded file, so staging is as it was.
      await lab.eval(() => { document.querySelector('[data-testid="post-role-screen"] button[aria-label="Cancel"]')?.click() })
      await sleep(800)
      await lab.eval(() => { const b = [...document.querySelectorAll('button')].find((x) => /^discard$/i.test(x.textContent?.trim() || '')); b?.click() })
    } finally { await restoreWidth(lab) }
  },

  async 'role-cover-render'(lab, ctx) {
    // Every width shows the cover: the phone hero or the desktop D2 cover column, so the viewport stays as the device has it.
    try {
      await lab.go(`/opportunities/${FIXTURES.coverRoleId}`)
      await lab.waitFor('h1', 20000)
      await sleep(1500)
      await ctx.shot('role-cover')
      const img = await lab.eval(() => { const i = document.querySelector('img[src*="role-covers"]'); return i ? { complete: i.complete, w: i.naturalWidth } : null })
      if (!img) throw new Error('the role page shows no cover photo for the fixture role')
      if (img.complete && img.w === 0) throw new Error('the cover photo failed to load (broken image)')
    } finally { await restoreWidth(lab) }
  },

  // ── Club speed (Figma 05 CS1–CS8). Nothing is written: every decision is
  // undone inside the Undo window and every sheet is cancelled. ──────────────

  async 'club-your-replies'(lab, ctx) {
    if (!(await phoneWidth(lab, ctx))) { ctx.note('tablet width: phone-only screen; skipped'); return }
    try {
      await lab.go('/opportunities')
      await lab.waitFor('[data-testid="club-opportunities-screen"]', 20000)
      await lab.waitFor('[data-testid="your-replies"]', 15000)
      await sleep(800)
      await ctx.shot('your-replies')
      const text = await lab.eval(() => document.querySelector('[data-testid="your-replies"]')?.textContent || '')
      if (!/You answered \d+ of \d+ applicants/.test(text)) throw new Error(`Your replies reads "${text.slice(0, 80)}"`)
      ctx.note(text.replace(/^Your replies · last 30 days/i, '').slice(0, 80))
    } finally { await restoreWidth(lab) }
  },

  async 'club-select-decline'(lab, ctx) {
    if (!(await phoneWidth(lab, ctx))) { ctx.note('tablet width: phone-only screen; skipped'); return }
    try {
      await lab.go(`/dashboard/opportunities/${FIXTURES.speedRoleId}/applicants`)
      await lab.waitFor('[data-testid="applicant-row"]', 20000)
      await sleep(1000)
      const rows = await lab.eval(() => document.querySelectorAll('[data-testid="applicant-row"]').length)
      if (rows < 2) throw new Error(`fixture role shows ${rows} applicant(s) to review; expected 2 (reset ${FIXTURES.speedRoleId} to pending)`)
      await lab.tap('[data-testid="applicants-select"]')
      await lab.waitFor('[data-testid="select-all"]', 5000)
      await lab.tap('[data-testid="select-all"]')
      await sleep(500)
      const bar = await lab.eval(() => document.querySelector('[data-testid="selection-bar"]')?.textContent || '')
      await ctx.shot('two-selected')
      if (!/2 selected/.test(bar) || !/Decline 2/.test(bar)) throw new Error(`selection bar reads "${bar}"`)
      await lab.tap('[data-testid="bulk-decline"]')
      await lab.waitFor('[data-testid="bulk-decline-sheet"]', 8000)
      await sleep(600)
      await lab.eval(() => { [...document.querySelectorAll('[data-testid="bulk-decline-sheet"] [role="radio"]')].find((b) => b.textContent?.trim() === 'Timing')?.click() })
      await lab.waitFor('[data-testid="bulk-decline-greeting"]', 5000)
      await sleep(500)
      await ctx.shot('decline-sheet')
      const note = await lab.eval(() => ({ greet: document.querySelector('[data-testid="bulk-decline-greeting"]')?.textContent || '', body: document.querySelector('[data-testid="bulk-decline-note"] textarea')?.value || '', send: document.querySelector('[data-testid="bulk-decline-send"]')?.textContent || '' }))
      if (!/^(Hi .+,|Hello,)$/.test(note.greet)) throw new Error(`greeting reads "${note.greet}"`)
      if (!/timing doesn’t work/.test(note.body)) throw new Error('note is not the fixed Timing template')
      if (!/Decline 2 and send/.test(note.send)) throw new Error(`send button reads "${note.send}"`)
      ctx.note('fixed note, personal greeting; cancelled, nothing sent')
      // Cancel the sheet, then leave select mode.
      await lab.eval(() => { [...document.querySelectorAll('[data-testid="bulk-decline-sheet"] button')].find((b) => b.textContent?.trim() === 'Cancel')?.click() })
      await sleep(600)
      await lab.eval(() => { document.querySelector('[data-testid="select-bar-top"] button')?.click() })
      await sleep(400)
    } finally { await restoreWidth(lab) }
  },

  async 'club-review-advance'(lab, ctx) {
    if (!(await phoneWidth(lab, ctx))) { ctx.note('tablet width: phone-only screen; skipped'); return }
    try {
      await lab.go(`/dashboard/opportunities/${FIXTURES.speedRoleId}/applicants`)
      await lab.waitFor('[data-testid="applicant-row"]', 20000)
      await sleep(1000)
      await lab.tap('[data-testid="applicant-row"]')
      await lab.waitFor('[data-testid="review-counter"]', 20000)
      await sleep(1200)
      const first = await lab.eval(() => ({ c: document.querySelector('[data-testid="review-counter"]')?.textContent || '', n: document.querySelector('[data-testid="review-name"]')?.textContent || '' }))
      await ctx.shot('review-1')
      if (!/^1 of 2 to review$/.test(first.c)) throw new Error(`counter reads "${first.c}"`)
      // Decide, wait for the next applicant, and press Undo — all inside the
      // page, so a slow emulator round-trip can't miss the 5 s Undo window.
      // Android: one in-page script (its round-trips are slow). iOS: the web view
      // doesn't let the app react while it waits on a page script, so step through.
      const r = lab.device.platform === 'ios' ? null : await lab.eval(() => new Promise((resolve) => {
        const read = () => ({ c: document.querySelector('[data-testid="review-counter"]')?.textContent || '', n: document.querySelector('[data-testid="review-name"]')?.textContent || '' })
        ;[...document.querySelectorAll('[data-testid="decision-bar"] button')].find((b) => b.textContent?.trim() === 'Maybe')?.click()
        const t0 = Date.now()
        const tick = () => {
          const now = read()
          const undo = document.querySelector('[data-testid="undo-toast"] button')
          if (now.c.startsWith('2 of') && undo) {
            undo.click()
            setTimeout(() => resolve({ second: now, toast: true, afterUndo: read().c, ms: Date.now() - t0 }), 600)
          } else if (Date.now() - t0 > 3500) resolve({ second: now, toast: Boolean(undo), afterUndo: null, ms: Date.now() - t0 })
          else setTimeout(tick, 100)
        }
        setTimeout(tick, 100)
      }))
      let second = r?.second
      let toast = r?.toast
      let afterUndo = r?.afterUndo ?? ''
      if (!second) {
        await lab.eval(() => { [...document.querySelectorAll('[data-testid="decision-bar"] button')].find((b) => b.textContent?.trim() === 'Maybe')?.click() })
        second = { c: '', n: '' }
        for (let i = 0; i < 12; i++) { await sleep(250); second = await lab.eval(() => ({ c: document.querySelector('[data-testid="review-counter"]')?.textContent || '', n: document.querySelector('[data-testid="review-name"]')?.textContent || '' })); if (second.c.startsWith('2 of')) break }
        toast = await lab.eval(() => { const b = document.querySelector('[data-testid="undo-toast"] button'); if (b) b.click(); return Boolean(b) })
        await sleep(600)
        afterUndo = await lab.eval(() => document.querySelector('[data-testid="review-counter"]')?.textContent || '')
      }
      await ctx.shot('review-2-after-undo')
      // The undone applicant is back in the queue, so this one is 1 of 2 again.
      if (!/^1 of 2 to review$/.test(afterUndo)) throw new Error(`after Undo the counter reads "${afterUndo}", expected 1 of 2`)
      if (!/^2 of 2 to review$/.test(second.c)) throw new Error(`after Maybe the counter reads "${second.c}"`)
      if (second.n === first.n) throw new Error('the same applicant stayed on screen after the decision')
      if (!toast) throw new Error('no Undo toast after the decision')
      ctx.note(`${first.n} → ${second.n}; Maybe undone`)
      await lab.eval(() => { document.querySelector('[data-testid="review-back"]')?.click() })
      await sleep(1000)
    } finally { await restoreWidth(lab) }
  },

  async 'club-close-sheet'(lab, ctx) {
    if (!(await phoneWidth(lab, ctx))) { ctx.note('tablet width: phone-only screen; skipped'); return }
    try {
      await lab.go(`/dashboard/opportunities/${FIXTURES.speedRoleId}/applicants`)
      await lab.waitFor('[data-testid="role-actions-button"]', 20000)
      await sleep(800)
      await lab.tap('[data-testid="role-actions-button"]')
      await lab.waitFor('[data-testid="role-actions-sheet"]', 8000)
      await sleep(500)
      await lab.eval(() => { [...document.querySelectorAll('[data-testid="role-actions-sheet"] button')].find((b) => /Close role/.test(b.textContent || ''))?.click() })
      await lab.waitFor('[data-testid="close-role-sheet"]', 8000)
      await lab.tap('[data-testid="close-role-withdrawn"]')
      await lab.waitFor('[data-testid="close-role-note"]', 8000)
      await sleep(600)
      await ctx.shot('close-sheet')
      const s = await lab.eval(() => ({ tell: document.querySelector('[data-testid="close-role-tell"]')?.getAttribute('aria-checked'), btn: document.querySelector('[data-testid="close-role-confirm"]')?.textContent || '' }))
      if (s.tell !== 'true') throw new Error('"Tell the players still waiting" is not on by default')
      if (!/Close role and tell 2 players/.test(s.btn)) throw new Error(`confirm reads "${s.btn}"`)
      ctx.note('Filled / Not filled + tell 2 players (on); cancelled')
      await lab.eval(() => { [...document.querySelectorAll('[data-testid="close-role-sheet"] button')].find((b) => b.textContent?.trim() === 'Cancel')?.click() })
      await sleep(500)
    } finally { await restoreWidth(lab) }
  },

  async 'club-post-again'(lab, ctx) {
    if (!(await phoneWidth(lab, ctx))) { ctx.note('tablet width: phone-only screen; skipped'); return }
    try {
      await lab.go('/opportunities')
      await lab.waitFor('[data-testid="club-opportunities-screen"]', 20000)
      await sleep(1000)
      await lab.tap('button[aria-label="Post an opportunity"]')
      await lab.waitFor('[data-testid="post-role-start"]', 8000)
      await lab.waitFor('[data-testid="post-role-again-row"]', 10000)
      await sleep(600)
      await ctx.shot('start-sheet')
      // The start sheet lists one row per closed role: copy the first.
      await lab.eval(() => { document.querySelector('[data-testid="post-role-again-row"]')?.click() })
      await lab.waitFor('[data-testid="post-again-note"]', 20000)
      await sleep(1200)
      await ctx.shot('check-screen')
      const parts = await lab.eval(() => ['role', 'who', 'offer', 'where', 'about'].filter((k) => document.querySelector(`[data-testid="ai-summary-${k}"]`)).length)
      if (parts !== 5) throw new Error(`check screen shows ${parts} of 5 parts`)
      ctx.note('closed role copied to the check screen; discarded')
      await lab.eval(() => { document.querySelector('[data-testid="post-role-screen"] button[aria-label="Cancel"]')?.click() })
      await sleep(800)
      await lab.eval(() => { [...document.querySelectorAll('button')].find((x) => /^discard$/i.test(x.textContent?.trim() || ''))?.click() })
      await sleep(800)
    } finally { await restoreWidth(lab) }
  },

  async 'club-ai-start'(lab, ctx) {
    if (!(await phoneWidth(lab, ctx))) { ctx.note('tablet width: phone-only screen; skipped'); return }
    try {
      await lab.go('/opportunities')
      await lab.waitFor('[data-testid="club-opportunities-screen"]', 20000)
      await sleep(1000)
      await lab.tap('button[aria-label="Post an opportunity"]')
      await lab.waitFor('[data-testid="post-role-ai-text"]', 8000)
      await lab.type('[data-testid="post-role-ai-text"]', 'Left back for our women’s 1st team, elite level, drag flicker, EU passport needed, paid, with housing, from January')
      await sleep(400)
      await ctx.shot('typed')
      const t0 = Date.now()
      await lab.tap('[data-testid="post-role-ai-draft"]')
      await lab.waitFor('[data-testid="post-role-ai-summary"], [data-testid="post-role-screen"]', 45000)
      await lab.waitFor('[data-testid="ai-summary-role"]', 10000)
      await sleep(1200)
      await ctx.shot('drafted')
      const role = await lab.eval(() => document.querySelector('[data-testid="ai-summary-role"]')?.textContent || '')
      if (!/Defender/.test(role) || !/Women/.test(role)) throw new Error(`drafted role reads "${role.slice(0, 80)}"`)
      const who = await lab.eval(() => { const el = document.querySelector('[data-testid="ai-summary-who"]'); el?.scrollIntoView({ block: 'center' }); return el?.textContent || '' })
      await sleep(600)
      await ctx.shot('who-you-want')
      if (!/EU passport required/.test(who)) throw new Error(`"Who you want" reads "${who.slice(0, 120)}"`)
      ctx.note(`who: ${who.slice(0, 200)}`)
      ctx.note(`drafted in ${Math.round((Date.now() - t0) / 100) / 10} s; discarded`)
      await lab.eval(() => { document.querySelector('[data-testid="post-role-screen"] button[aria-label="Cancel"]')?.click() })
      await sleep(800)
      await lab.eval(() => { [...document.querySelectorAll('button')].find((x) => /^discard$/i.test(x.textContent?.trim() || ''))?.click() })
      await sleep(800)
    } finally { await restoreWidth(lab) }
  },

  async 'club-sign-out'(lab, ctx) {
    await signOut(lab)
    await ctx.shot('signed-out')
  },
  // ── Brand campaigns (--scenario brand). Nothing is saved or published. ──
  async 'brand-sign-in'(lab, ctx) {
    await signInAs(lab, ctx, brandCredentials(), 'brand')
  },

  /** The campaign list, the Hockia AI sheet, its campaign cards and the empty composer with the keyboard up. */
  async 'brand-campaigns'(lab, ctx) {
    await lab.go('/dashboard/offers')
    await lab.waitFor('[data-testid="brand-offers"]', 30000)
    await sleep(1500)
    await ctx.shot('list')
    const m = await layoutFacts(lab, 'body')
    if (m.overflowX > 1) throw new Error(`campaign list scrolls sideways by ${m.overflowX}px`)
    await lab.tap('[data-testid="hockia-ai-button"]')
    await lab.waitFor('[data-testid="hockia-ai-sheet"]', 8000)
    await sleep(900)
    await ctx.shot('sheet')
    const options = await lab.eval(() => document.querySelectorAll('[data-testid="hockia-ai-option"]').length)
    ctx.note(`${options} choices in the sheet`)
    await lab.eval(() => { document.querySelectorAll('[data-testid="hockia-ai-option"]')[2]?.click() })
    await lab.waitFor('[data-testid="hockia-ai-campaigns"]', 8000)
    try { await lab.waitFor('[data-testid="hockia-ai-campaigns-lead"]', 20000) } catch { ctx.note('campaign cards never showed their lead line') }
    await sleep(800)
    await ctx.shot('campaign-cards')
    const cards = await layoutFacts(lab, '[data-testid="hockia-ai-sheet"]')
    ctx.note(`campaign cards: small targets ${JSON.stringify(cards.small)}, off screen ${JSON.stringify(cards.off)}`)
    await lab.swipeUp(0.4)
    await ctx.shot('campaign-cards-scrolled')
  },

  /**
   * A sentence, the draft card, then "Continue in the editor". With
   * LAB_MOCK_DRAFT=1 the function's answer is given in the page, so no model
   * call is made and none of the brand's 15 daily drafts is used; without it,
   * one real call (about 0.003 USD). "Continue" saves a draft campaign: the
   * journey deletes it from the list afterwards.
   */
  async 'brand-campaign-draft'(lab, ctx) {
    const mocked = process.env.LAB_MOCK_DRAFT === '1'
    await lab.go('/dashboard/offers')
    await lab.waitFor('[data-testid="brand-offers"]', 30000)
    await sleep(1200)
    await lab.tap('[data-testid="hockia-ai-button"]')
    await lab.waitFor('[data-testid="hockia-ai-sheet"]', 8000)
    await sleep(700)
    await lab.eval(() => { document.querySelectorAll('[data-testid="hockia-ai-option"]')[0]?.click() })
    await lab.waitFor('[data-testid="hockia-ai-campaign-composer"]', 8000)
    await sleep(600)
    await ctx.shot('composer-empty')
    if (mocked) {
      await lab.eval((answer) => {
        const real = window.fetch.bind(window)
        window.fetch = (input, init) => (String(typeof input === 'string' ? input : input?.url ?? input).includes('/functions/v1/campaign-draft')
          ? ((window.__labDraftMocked = true), Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } })))
          : real(input, init))
      }, { draft: { objective: 'offer', title: '[QA] Lab 15% off new carbon sticks', body: 'Players get 15% off our new carbon sticks this month with code LAB15.', need: 'gear', roles: ['player'], place: 'everywhere', perk: '15% off', promo_code: 'LAB15' }, source: 'ai' })
      ctx.note('draft answer mocked in the page: no model call')
    }
    await lab.type('[data-testid="hockia-ai-campaign-input"]', 'Players get 15% off our new carbon sticks this month with code LAB15')
    await sleep(900)
    await ctx.shot('composer-typed-keyboard')
    // With the keyboard up, the send button must still be on screen.
    const send = await lab.eval(() => { const b = document.querySelector('[data-testid="hockia-ai-campaign-send"]')?.getBoundingClientRect(); const vv = window.visualViewport; return b ? { top: Math.round(b.top), bottom: Math.round(b.bottom), visibleHeight: Math.round(vv ? vv.height + vv.offsetTop : window.innerHeight), inner: window.innerHeight } : null })
    ctx.note(`send button with keyboard: ${JSON.stringify(send)}`)
    if (send && send.bottom > send.visibleHeight + 1) ctx.note('SEND BUTTON IS UNDER THE KEYBOARD')
    const t0 = Date.now()
    await lab.tap('[data-testid="hockia-ai-campaign-send"]')
    await sleep(600)
    await ctx.shot('thinking')
    await lab.waitFor('[data-testid="hockia-ai-campaign-draft"], [data-testid="hockia-ai-campaign-failed"]', 45000)
    await sleep(900)
    await ctx.shot('result')
    if (mocked && !(await lab.eval(() => window.__labDraftMocked === true))) throw new Error('LAB_MOCK_DRAFT=1 but the page did not use the mocked answer: a real model call was made')
    const failed = await lab.eval(() => document.querySelector('[data-testid="hockia-ai-campaign-failed"]')?.textContent || '')
    if (failed) throw new Error(`no draft: "${failed.slice(0, 120)}"`)
    const draft = await lab.eval(() => ({ title: document.querySelector('[data-testid="hockia-ai-campaign-draft-title"]')?.textContent, perk: document.querySelector('[data-testid="hockia-ai-campaign-draft-perk"]')?.textContent, code: document.querySelector('[data-testid="hockia-ai-campaign-draft-code"]')?.textContent, forWho: document.querySelector('[data-testid="hockia-ai-campaign-draft-for"]')?.textContent }))
    ctx.note(`drafted in ${Math.round((Date.now() - t0) / 100) / 10} s: ${JSON.stringify(draft)}`)
    const facts = await layoutFacts(lab, '[data-testid="hockia-ai-sheet"]')
    ctx.note(`draft card: small targets ${JSON.stringify(facts.small)}, off screen ${JSON.stringify(facts.off)}, sideways ${facts.overflowX}`)
    await lab.swipeUp(0.4)
    await ctx.shot('result-scrolled')
    await lab.tap('[data-testid="hockia-ai-campaign-continue"]')
    await lab.waitFor('[data-testid="offer-editor"]', 15000)
    await sleep(1500)
    await ctx.shot('editor-top')
    const fields = await lab.eval(() => ({ title: document.querySelector('#offer-title')?.value, perk: document.querySelector('[data-testid="offer-perk-input"]')?.value, code: document.querySelector('[data-testid="offer-code-input"]')?.value, end: document.querySelector('[data-testid="offer-end-input"]')?.value }))
    ctx.note(`editor fields: ${JSON.stringify(fields)}`)
    if (!fields.title) throw new Error('the editor opened without the drafted title')
    // Which elements reach past the screen edge, so a sideways scroll can be traced; the failure is raised after the clean-up.
    const wide = await lab.eval(() => {
      const vw = window.innerWidth
      const past = [...document.querySelectorAll('[data-testid="offer-editor"] *')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > vw + 0.5 })
      const leaf = past.filter((el) => !past.some((o) => o !== el && el.contains(o)))
      return { by: document.documentElement.scrollWidth - vw, vw, els: leaf.slice(0, 6).map((el) => { const b = el.getBoundingClientRect(); return `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}${el.id ? `#${el.id}` : ''}.${String(el.className).slice(0, 70)} left=${Math.round(b.left)} right=${Math.round(b.right)} y=${Math.round(b.top + window.scrollY)}` }) }
    })
    // Date fields (added 2026-11-22): each native picker opens on tap; another end date is picked, saved with the draft and read back after reopening it.
    const ios = lab.device.platform === 'ios'
    const center = async (sel) => { await lab.backToWeb(); await lab.eval((q) => { document.querySelector(q)?.scrollIntoView({ block: 'center' }) }, sel); await sleep(900) }
    const labels = async () => { await lab.native(); const src = await lab.driver.getPageSource(); return [...new Set([...src.matchAll(/(?:label|content-desc|text)="([^"]{0,60}(?:Dec|dic|Nov|nov)[^"]{0,40}|OK|Cancel|Done|Set|Reset|Aceptar|Cancelar|Listo|[0-9]{1,2})"/g)].map((m) => m[1]))].slice(0, 60) }
    const tapNative = async (selectors) => { await lab.native(); for (const q of selectors) { try { const el = await lab.driver.$(q); if (await el.isExisting()) { await el.click(); return q } } catch { /* next */ } } return null }
    // Start field: only that the picker opens; dismissed without choosing.
    await center('#offer-start')
    await ctx.shot('dates-before')
    await lab.tap('#offer-start'); await sleep(1800)
    await ctx.shot('start-picker-open')
    if (ios) { await lab.native(); await lab.driver.execute('mobile: tap', { x: 220, y: 120 }); } else { const c = await tapNative(['android=new UiSelector().resourceId("android:id/button2")', 'android=new UiSelector().textMatches("(?i)cancel|cancelar")']); ctx.note(`start picker dismissed with ${c}`) }
    await sleep(1000)
    ctx.note(`start value after dismiss: ${JSON.stringify(await lab.eval(() => document.querySelector('#offer-start')?.value))}`)
    // End field: pick a day near the default end (today + 14), in the same month the picker opens on and inside the 7 to 15 day window.
    const end0 = new Date(); end0.setDate(end0.getDate() + 14)
    const want = new Date(end0); want.setDate(end0.getDate() + (end0.getDate() > 2 ? -2 : 1))
    const dd = want.getDate(); const yyyy = want.getFullYear()
    const monthEn = want.toLocaleString('en-GB', { month: 'long' }); const monthEs = want.toLocaleString('es', { month: 'long' })
    const wantIso = `${yyyy}-${String(want.getMonth() + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    await center('#offer-end')
    await lab.tap('#offer-end'); await sleep(1800)
    await ctx.shot('end-picker-open')
    const seen = await labels()
    if (!seen.length) ctx.note('the end date picker showed no day labels')
    const day = ios
      ? await tapNative([`-ios predicate string:label ENDSWITH " ${dd} ${monthEn}" OR label ENDSWITH " ${dd} de ${monthEs}"`, `-ios predicate string:label == "${dd}"`])
      : await tapNative([`android=new UiSelector().descriptionMatches("(?i)0?${dd} (${monthEn}|de ${monthEs} de) ${yyyy}")`, `android=new UiSelector().text("${dd}")`])
    ctx.note(`day tapped with ${day}`)
    await sleep(900)
    await ctx.shot('end-picker-day-chosen')
    const ok = ios
      ? await tapNative(['~Done', '~Confirm', '-ios predicate string:label == "Done" OR label == "Confirm" OR label == "Listo" OR label == "OK"'])
      : await tapNative(['android=new UiSelector().resourceId("android:id/button1")', 'android=new UiSelector().textMatches("(?i)ok|set|aceptar")'])
    ctx.note(`picker confirmed with ${ok}`)
    if (ios && !ok) { await lab.native(); await lab.driver.execute('mobile: tap', { x: 220, y: 120 }) }
    await sleep(1200)
    await lab.backToWeb()
    const picked = await lab.eval(() => document.querySelector('#offer-end')?.value)
    ctx.note(`end date picked: ${picked} (wanted ${wantIso})`)
    if (picked !== wantIso) throw new Error(`the end date field holds ${picked} after picking ${wantIso}`)
    await center('#offer-end')
    await ctx.shot('dates-after-pick')
    // Save the draft, reopen it from the list, read the date again.
    await lab.tap('[data-testid="offer-save-draft"]')
    await lab.waitFor('[data-testid="brand-offers"]', 30000)
    await sleep(2500)
    const reopened = await lab.eval((t) => { const row = [...document.querySelectorAll('[data-testid="offer-row"]')].find((r) => r.textContent?.includes(t)); row?.querySelector('[data-testid="offer-row-menu"]')?.click(); return Boolean(row) }, fields.title)
    if (reopened) {
      await lab.waitFor('[data-testid="offer-action-edit"]', 8000)
      await lab.tap('[data-testid="offer-action-edit"]')
      await lab.waitFor('[data-testid="offer-editor"]', 15000)
      await sleep(1500)
      const kept = await lab.eval(() => document.querySelector('#offer-end')?.value)
      ctx.note(`end date after save and reopen: ${kept}`)
      if (kept !== wantIso) throw new Error(`the end date reads ${kept} after save and reopen, not ${wantIso}`)
      await center('#offer-end')
      await ctx.shot('dates-after-reopen')
      await lab.eval(() => window.scrollTo(0, 0)); await sleep(400)
    } else ctx.note('the saved draft was not found in the list to reopen')
    const sideways = wide.by > 1 ? `editor scrolls sideways by ${wide.by}px at ${wide.vw}px: ${wide.els.join(' | ') || 'no element past the edge found'}` : null
    await lab.swipeUp(0.6); await ctx.shot('editor-middle')
    await lab.swipeUp(0.6); await ctx.shot('editor-bottom')
    // "Continue" saved a draft campaign: delete it, so the run leaves the brand as it found it.
    const title = fields.title
    await lab.go('/dashboard/offers')
    await lab.waitFor('[data-testid="brand-offers"]', 30000)
    await sleep(1500)
    const opened = await lab.eval((t) => {
      const row = [...document.querySelectorAll('[data-testid="offer-row"]')].find((r) => r.textContent?.includes(t))
      row?.querySelector('[data-testid="offer-row-menu"]')?.click()
      return Boolean(row)
    }, title)
    if (!opened) { ctx.note(`the saved draft "${title}" was not in the list: nothing deleted`); if (sideways) throw new Error(sideways); return }
    await lab.waitFor('[data-testid="offer-action-delete"]', 8000)
    await lab.tap('[data-testid="offer-action-delete"]')
    await lab.waitFor('[data-testid="offer-confirm-yes"]', 8000)
    await lab.tap('[data-testid="offer-confirm-yes"]')
    await sleep(4000)
    const left = await lab.eval((t) => [...document.querySelectorAll('[data-testid="offer-row"]')].filter((r) => r.textContent?.includes(t)).length, title)
    const cleaned = left ? `${left} draft(s) titled "${title}" still in the list` : 'the saved draft was deleted'
    ctx.note(cleaned)
    if (sideways) throw new Error(`${sideways} (${cleaned})`)
  },

  async 'brand-sign-out'(lab, ctx) {
    await signOut(lab)
    await ctx.shot('signed-out')
  },
}

export const CORE_ORDER = ['sign-in', 'home-feed', 'opportunities-role-apply', 'hockia-ai-sheet', 'role-cover-render', 'inbox-thread', 'community-profile', 'profile-edit']
export const CLUB_ORDER = ['club-sign-in', 'club-roles', 'club-post-role-cover', 'role-cover-render', 'club-sign-out']
// Club speed journeys (--scenario club-speed): sign in as the club, run them, sign out.
export const CLUB_SPEED_ORDER = ['club-sign-in', 'club-your-replies', 'club-select-decline', 'club-review-advance', 'club-close-sheet', 'club-post-again', 'club-ai-start', 'club-sign-out']
// Brand campaign journeys (--scenario brand). brand-campaign-draft makes one real model call unless LAB_MOCK_DRAFT=1.
export const BRAND_ORDER = ['brand-sign-in', 'brand-campaigns', 'brand-campaign-draft', 'brand-sign-out']
