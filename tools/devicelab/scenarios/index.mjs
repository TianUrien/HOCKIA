/**
 * The core journeys, written once against the lab API (lib/appium.mjs and
 * lib/web.mjs). Each scenario is `async (lab, ctx) => void`; it throws to
 * fail and calls ctx.shot(name) to keep a screenshot. ctx.writes is false
 * by default: scenarios open the apply sheet and type a message but never
 * submit, so a run leaves staging as it found it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { qaCredentials, clubCredentials, LAB_DIR } from '../lib/config.mjs'

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
}

/** Publisher screens are phone-only (max-width 1023). Desktop browsers run
 *  them at a phone viewport; tablets report false and the journey is skipped. */
async function phoneWidth(lab, ctx) {
  if (lab.device.platform === 'web') { await lab.page.setViewportSize({ width: 390, height: 844 }); ctx.note('web viewport 390×844: publisher screens are phone-only'); return true }
  return lab.eval(() => window.innerWidth < 1024)
}
async function restoreWidth(lab) { if (lab.device.platform === 'web' && lab.device.viewport) await lab.page.setViewportSize(lab.device.viewport) }

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
  async 'hockia-ai-sheet'(lab, ctx) {
    await lab.go('/opportunities')
    await lab.waitFor('[data-testid="hockia-ai-button"]', 20000)
    await sleep(800)
    await lab.eval(() => { localStorage.setItem('hockia-ai-tip-seen', '1'); document.querySelector('[data-testid="hockia-ai-button"]')?.click() })
    await lab.waitFor('[data-testid="hockia-ai-sheet"]', 15000)
    await sleep(1500)
    await ctx.shot('sheet-medium')
    const medium = await lab.eval(() => ({ detent: document.querySelector('[data-testid="hockia-ai-sheet"]')?.getAttribute('data-detent'), suggestions: document.querySelectorAll('[data-testid="hockia-ai-suggestion"]').length, beta: !!document.querySelector('[data-testid="hockia-ai-beta"]') }))
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

  async 'club-sign-out'(lab, ctx) {
    await signOut(lab)
    await ctx.shot('signed-out')
  },
}

export const CORE_ORDER = ['sign-in', 'home-feed', 'opportunities-role-apply', 'hockia-ai-sheet', 'role-cover-render', 'inbox-thread', 'community-profile', 'profile-edit']
export const CLUB_ORDER = ['club-sign-in', 'club-roles', 'club-post-role-cover', 'role-cover-render', 'club-sign-out']
