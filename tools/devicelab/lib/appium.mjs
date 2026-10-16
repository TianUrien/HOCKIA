/**
 * Appium side of the lab: one server for the run, one session per device,
 * and the small "lab" API the scenarios are written against. The app is a
 * WebView, so every DOM read/write runs in the WEBVIEW context and every
 * gesture (swipe, tap by coordinates) runs in NATIVE_APP, exactly as a thumb
 * would. That split is the point: a frozen page LOOKS fine to a DOM check
 * (scrollTo works) and only a real swipe shows it.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { remote } from 'webdriverio'
import { APP_ID, APP_ORIGIN, APPIUM_PORT, ANDROID_APK, ANDROID_SDK, IOS_APP, JAVA_HOME, WDA_DERIVED } from './config.mjs'
import { simulatorUdid, bootSimulator, cleanAvdLocks, killEmulators } from './sim.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function startAppium(logFile) {
  const bin = path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname)), 'node_modules', '.bin', 'appium')
  const level = process.env.LAB_DEBUG === '1' ? 'debug' : 'info'
  const child = spawn(bin, ['--port', String(APPIUM_PORT), '--allow-insecure', 'uiautomator2:chromedriver_autodownload', '--log', logFile, '--log-level', level, '--log-no-colors'], {
    env: { ...process.env, ANDROID_HOME: ANDROID_SDK, ANDROID_SDK_ROOT: ANDROID_SDK, JAVA_HOME },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${APPIUM_PORT}/status`); if (r.ok) return child } catch { /* not up yet */ }
    await sleep(500)
  }
  child.kill()
  throw new Error('Appium did not start in 30 s (see ' + logFile + ')')
}

function capabilitiesFor(device) {
  if (device.platform === 'ios') {
    const udid = device.udid ?? simulatorUdid(device.simulator, device.runtime)
    bootSimulator(udid)
    return {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': udid,
      'appium:app': IOS_APP,
      'appium:bundleId': APP_ID,
      'appium:newCommandTimeout': 600,
      'appium:wdaLaunchTimeout': 300000,
      'appium:simulatorStartupTimeout': 300000,
      'appium:autoAcceptAlerts': true,
      'appium:fullContextList': true,
      'appium:webviewConnectTimeout': 30000,
      'appium:includeSafariInWebviews': false,
      'appium:showXcodeLog': false,
      // Headless: Xcode 27 moved Simulator.app and the driver cannot open the
      // window; gestures and screenshots work the same without it.
      'appium:isHeadless': true,
      // Prebuilt WebDriverAgent (see build.mjs): Appium's own build fails on
      // Xcode 27 because the project's deployment target is iOS 12.
      'appium:usePrebuiltWDA': true,
      // iOS 27 reports the app's WebView under the process name ("process-App"),
      // not the bundle id, so the driver would skip it without this.
      'appium:additionalWebviewBundleIds': ['process-App', 'App', APP_ID],
      // Clean install per session (sign-in runs every time): a previous run's
      // state (open sheets, last route) must not leak into this one.
      // LAB_KEEP_STATE=1 keeps the app as it was.
      ...(process.env.LAB_KEEP_STATE === '1' ? {} : { 'appium:fullReset': true }),
      'appium:derivedDataPath': WDA_DERIVED,
    }
  }
  if (device.platform === 'android') {
    killEmulators()
    cleanAvdLocks(device.avd)
    return {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:avd': device.avd,
      'appium:app': ANDROID_APK,
      'appium:appPackage': APP_ID,
      'appium:appWaitActivity': '*',
      'appium:avdLaunchTimeout': 300000,
      'appium:avdReadyTimeout': 300000,
      'appium:autoGrantPermissions': true,
      'appium:chromedriverAutodownload': true,
      'appium:newCommandTimeout': 600,
      'appium:avdArgs': '-no-snapshot-load -no-boot-anim',
      ...(process.env.LAB_KEEP_STATE === '1' ? {} : { 'appium:fullReset': true }),
    }
  }
  throw new Error(`Not an Appium device: ${device.id}`)
}

export async function openSession(device) {
  // A fresh emulator sometimes refuses the first helper-app start while it
  // is still settling ("Cannot start io.appium.settings"): one retry.
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const driver = await remote({ hostname: '127.0.0.1', port: APPIUM_PORT, path: '/', logLevel: 'warn', connectionRetryTimeout: 600000, capabilities: capabilitiesFor(device) })
      return new AppiumLab(driver, device)
    } catch (err) {
      lastErr = err
      if (attempt === 0) await sleep(15000)
    }
  }
  throw lastErr
}

export class AppiumLab {
  constructor(driver, device) { this.driver = driver; this.device = device; this.webview = null }

  /** Switch to the app's WebView context (found by url/origin, not by index). */
  async web() {
    // Re-discovery is slow on Android (the driver probes every WebView on the
    // device, 2 s each); keep the id once found and only look again if a
    // command later fails with a stale context.
    if (this.webview && this.webview !== 'NATIVE_APP') return
    for (let i = 0; i < 60; i++) {
      let ctxs = []
      try { ctxs = await this.driver.getContexts() } catch { await sleep(1000); continue }
      const list = ctxs.map((c) => (typeof c === 'string' ? { id: c } : c))
      // The app's page: served from its own origin on Android (https://app.inhockia.com)
      // and from capacitor://localhost on iOS; the title is the app's.
      const ours = (c) => !c.url || c.url.startsWith(APP_ORIGIN) || /^(capacitor|hockia|ionic):\/\//.test(c.url) || /hockia/i.test(c.title || '') || c.id.includes(APP_ID)
      const wv = list.find((c) => c.id.startsWith('WEBVIEW') && ours(c))
      if (wv) {
        try { await this.driver.switchContext(wv.id); this.webview = wv.id; return } catch { await sleep(500); continue }
      }
      await sleep(500)
    }
    throw new Error(`No WebView context for ${APP_ID}`)
  }

  async native() { if (this.webview !== 'NATIVE_APP') { await this.driver.switchContext('NATIVE_APP'); this.lastWebview = this.webview; this.webview = 'NATIVE_APP' } }

  /** After a gesture, go back to the WebView without re-probing every context. */
  async backToWeb() {
    if (this.lastWebview && this.webview === 'NATIVE_APP') {
      try { await this.driver.switchContext(this.lastWebview); this.webview = this.lastWebview; return } catch { /* target gone after a navigation: find it again */ }
    }
    this.webview = null; this.lastWebview = null
    await this.web()
  }

  /** A full navigation closes chromedriver's target on Android: forget the cached context and find it again. */
  isStaleWindow(err) { return /no such window|target window already closed|web view not found|not attached/i.test(String(err?.message ?? err)) }

  async rediscover() { this.webview = null; this.lastWebview = null; await this.web() }

  /** Run JS in the page and return its value (one retry after a stale window). */
  async eval(script, ...args) {
    await this.backToWeb()
    try { return await this.driver.execute(script, ...args) } catch (err) {
      if (!this.isStaleWindow(err)) throw err
      await this.rediscover()
      return this.driver.execute(script, ...args)
    }
  }

  /** Navigate the SPA (full load of the route, served by the app's own server). */
  async go(route) {
    const wanted = route.split('?')[0]
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await this.eval((r) => { window.location.assign(r) }, route) } catch (err) { if (!this.isStaleWindow(err)) throw err }
      await sleep(2000)
      await this.rediscover()
      await this.waitFor('#root *', 20000)
      // The app may redirect (/dashboard → /dashboard/profile, guards); accept
      // any path that starts with what was asked for, retry when it stayed put.
      const path = await this.eval(() => window.location.pathname)
      if (path.startsWith(wanted) || wanted === '/') return
      if (attempt === 2) throw new Error(`navigation to ${route} ended on ${path}`)
    }
  }

  async waitFor(selector, timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await this.eval((s) => !!document.querySelector(s), selector)) return
      await sleep(250)
    }
    throw new Error(`Timed out waiting for ${selector}`)
  }

  async tap(selector) {
    await this.backToWeb()
    try { await this.driver.getTitle() } catch (err) { if (this.isStaleWindow(err)) await this.rediscover(); else throw err }
    const el = await this.driver.$(selector)
    await el.waitForExist({ timeout: 15000 })
    try { await el.waitForEnabled({ timeout: 10000 }) } catch { /* fall through to the click attempt */ }
    try {
      await el.click()
    } catch (err) {
      // A click that navigates closes chromedriver's target: that is success.
      if (this.isStaleWindow(err)) { this.webview = null; return }
      // WebDriver refuses clicks on elements it thinks are covered or moving
      // (transition classes, sticky bars); a DOM click reaches the handler.
      await this.driver.execute((sel) => { const b = document.querySelector(sel); if (!b) throw new Error(`no ${sel}`); b.click() }, selector)
    }
  }

  async type(selector, text) {
    await this.backToWeb()
    try { await this.driver.getTitle() } catch (err) { if (this.isStaleWindow(err)) await this.rediscover(); else throw err }
    const el = await this.driver.$(selector)
    await el.waitForExist({ timeout: 15000 })
    try {
      await el.click()
      await el.setValue(text)
    } catch {
      // Not interactable for WebDriver (desktop-width layouts, inputs inside
      // transformed containers): set it the way React expects, through the
      // native value setter plus an input event.
      await this.driver.execute((sel, value) => {
        const input = document.querySelector(sel)
        if (!input) throw new Error(`no ${sel}`)
        input.focus()
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, selector, text)
    }
  }

  /** A thumb swipe up (content moves up = scroll down) in the native layer. */
  async swipeUp(fraction = 0.5) {
    await this.native()
    // Window size once per session: the Android agent has hung on repeated
    // window/rect calls after ~10 minutes of use.
    if (!this.size) this.size = await this.driver.getWindowSize()
    const { width, height } = this.size
    const x = Math.round(width / 2), y1 = Math.round(height * 0.75), y2 = Math.round(height * (0.75 - fraction))
    await this.driver.action('pointer', { parameters: { pointerType: 'touch' } }).move({ x, y: y1 }).down().pause(80).move({ x, y: y2, duration: 400 }).up().perform()
    await sleep(600)
  }

  async shot(file) { await this.native(); await this.driver.saveScreenshot(file) }

  async url() { return this.eval(() => window.location.pathname + window.location.search) }

  async close() {
    try { await this.driver.deleteSession() } catch { /* already gone */ }
    if (this.device.platform === 'android') killEmulators()
  }
}
