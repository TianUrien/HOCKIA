/**
 * Playwright side of the lab for the desktop devices: the same lab API as
 * lib/appium.mjs, so every scenario runs unchanged on phones, tablets and
 * desktop. Desktop has no thumb, so swipeUp is a mouse wheel.
 */
import path from 'node:path'
import { CLIENT_DIR, WEB_BASE } from './config.mjs'

const pw = await import(path.join(CLIENT_DIR, 'node_modules', 'playwright', 'index.mjs'))

export async function openWeb(device) {
  const browser = await pw[device.browser].launch()
  const ctx = await browser.newContext({ viewport: device.viewport })
  await ctx.addInitScript(() => { try { localStorage.setItem('hockia-cookie-consent', 'accepted') } catch { /* private mode */ } })
  const page = await ctx.newPage()
  return new WebLab(browser, page, device)
}

export class WebLab {
  constructor(browser, page, device) { this.browser = browser; this.page = page; this.device = device }
  async web() {}
  async native() {}
  async eval(script, ...args) { return this.page.evaluate(script, ...args) }
  async go(route) { await this.page.goto(WEB_BASE + route, { waitUntil: 'networkidle' }); await this.page.waitForTimeout(800) }
  // Presence, not visibility: desktop pages also carry the CSS-hidden phone tree, and
  // Playwright's default (visible) would wait on the first, hidden match forever.
  async waitFor(selector, timeout = 15000) { await this.page.waitForSelector(selector, { timeout, state: 'attached' }) }
  async tap(selector) { await this.page.locator(selector).first().click() }
  async type(selector, text) { await this.page.locator(selector).first().fill(text) }
  async swipeUp(fraction = 0.5) { await this.page.mouse.move(this.device.viewport.width / 2, this.device.viewport.height / 2); await this.page.mouse.wheel(0, this.device.viewport.height * fraction); await this.page.waitForTimeout(500) }
  async swipeDown(fraction = 0.5) { await this.page.mouse.move(this.device.viewport.width / 2, this.device.viewport.height / 2); await this.page.mouse.wheel(0, -this.device.viewport.height * fraction); await this.page.waitForTimeout(500) }
  async shot(file) { await this.page.screenshot({ path: file }) }
  async url() { const u = new URL(this.page.url()); return u.pathname + u.search }
  async close() { await this.browser.close() }
}
