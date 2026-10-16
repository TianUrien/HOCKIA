/**
 * The core journeys, written once against the lab API (lib/appium.mjs and
 * lib/web.mjs). Each scenario is `async (lab, ctx) => void`; it throws to
 * fail and calls ctx.shot(name) to keep a screenshot. ctx.writes is false
 * by default: scenarios open the apply sheet and type a message but never
 * submit, so a run leaves staging as it found it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { qaCredentials, LAB_DIR } from '../lib/config.mjs'

const FIXTURES = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'fixtures.json'), 'utf8')).staging

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Did anything scroll? Phones scroll the document; the desktop-width layout
 * (tablets) scrolls an inner container. Measure both: window.scrollY plus
 * the scrollTop of every scrollable element, before and after the swipe.
 */
const SCROLL_STATE = () => {
  const els = [...document.querySelectorAll('*')].filter((el) => { const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 40 })
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
  await lab.swipeUp(0.5)
  const after = await lab.eval(SCROLL_STATE)
  await ctx.shot(`${label}-after-swipe`)
  const moved = after.y > before.y || after.inner > before.inner
  if (after.tall && !moved) throw new Error(`${label}: swipe did not scroll (scrollY ${before.y} → ${after.y}, inner ${before.inner} → ${after.inner}, ${after.scrollers} scrollers; body ${after.pos}, lock=${after.locked})`)
  return after
}

/** An inner scroller (chat thread, deck) must move on a thumb swipe. */
async function assertInnerScrolled(lab, ctx, selector, label) {
  const before = await lab.eval((s) => document.querySelector(s)?.scrollTop ?? null, selector)
  await lab.swipeUp(0.4)
  const after = await lab.eval((s) => { const el = document.querySelector(s); return el ? { top: el.scrollTop, tall: el.scrollHeight > el.clientHeight + 40 } : null }, selector)
  await ctx.shot(`${label}-after-swipe`)
  if (!after) throw new Error(`${label}: scroller ${selector} not found`)
  if (after.tall && after.top === before) throw new Error(`${label}: swipe did not move ${selector} (scrollTop stayed ${before})`)
}

export const scenarios = {
  async 'sign-in'(lab, ctx) {
    const { email, password } = qaCredentials()
    await lab.go('/signin')
    await sleep(1500)
    // App data survives between runs when the same build is already installed:
    // an already signed-in account lands on /home. That is fine.
    if (!(await lab.url()).startsWith('/signin')) { ctx.note('already signed in from a previous run'); await ctx.shot('already-signed-in'); return }
    // The native app opens on its welcome screen; "Log in" leads to the form.
    const hasForm = await lab.eval(() => !!document.querySelector('input[type="email"]'))
    if (!hasForm) {
      await ctx.shot('welcome')
      await lab.eval(() => { const b = [...document.querySelectorAll('a, button')].find((x) => /^log in$/i.test(x.textContent?.trim() || '')); b?.click() })
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
      // Desktop: a card opens a preview modal (no route); the role page itself is a URL.
      const clicked = await lab.eval(() => { const c = document.querySelector('.cursor-pointer.rounded-2xl'); if (!c) return false; c.click(); return true })
      if (!clicked) throw new Error('no opportunity card on the desktop list')
      await lab.waitFor('[role="dialog"]', 15000)
      await sleep(500)
      await ctx.shot('preview-modal')
      await lab.eval(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      for (const id of FIXTURES.roleIds) {
        await lab.go(`/opportunities/${id}`)
        await lab.waitFor('[role="dialog"], h1', 20000)
        await sleep(800)
        await ctx.shot('role-page')
        const state = await assertScrolled(lab, ctx, 'role-page')
        if (state.tall) return
      }
      ctx.note('fixture roles fit the desktop dialog; scroll could not be asserted')
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
      await lab.native()
      const { width, height } = await lab.driver ? await lab.driver.getWindowSize() : { width: lab.device.viewport?.width ?? 400, height: lab.device.viewport?.height ?? 800 }
      void width; void height
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
}

export const CORE_ORDER = ['sign-in', 'home-feed', 'opportunities-role-apply', 'inbox-thread', 'community-profile', 'profile-edit']
